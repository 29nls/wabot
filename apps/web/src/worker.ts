import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import {
  consumeRateLimit,
  constantTimeEqualText,
  randomToken,
  signSession,
  verifyPassword,
  verifySession,
  type SessionPayload
} from './auth';
import { SCHEMA_VERSION, ensureSchema } from './schema';
import {
  PAIR_CODE_TTL_MS,
  PAIR_COOLDOWN_MS,
  PAIR_LIMIT,
  PAIR_REQUEST_TTL_MS,
  PAIR_WINDOW_MS,
  canTransition,
  isFinalPairStatus,
  maskPhone,
  normalizePairCode,
  normalizePhone,
  type PairStatus
} from './pairing';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DASHBOARD_PASSWORD_HASH: string;
  SESSION_SECRET: string;
  // Sites meng-inject APP_ORIGIN sebagai variabel reserved; saat dijalankan tanpa
  // variabel itu (mis. preview lokal) origin request dipakai sebagai acuan.
  APP_ORIGIN?: string;
  SCHEMA_BOOTSTRAP?: string;
  BOT_API_KEY?: string;
  BOT_API_KEY_PREVIOUS?: string;
  BOT_ID?: string;
}

type AppContext = Context<{ Bindings: Env; Variables: { session: SessionPayload } }>;

const SESSION_COOKIE = 'wabot_session';
const CSRF_HEADER = 'X-CSRF-Token';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 60 * 1000;
const MAX_BODY_BYTES = 4096;
const BOT_LIMIT = 120;
const BOT_WINDOW_MS = 60 * 1000;
const BOT_ERROR_CODES = ['code_expired', 'code_invalid', 'logged_out', 'timeout'] as const;
const encoder = new TextEncoder();

const securityHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

const app = new Hono<{ Bindings: Env; Variables: { session: SessionPayload } }>();

function ok(c: AppContext, data: unknown, status: ContentfulStatusCode = 200) {
  return c.json({ ok: true, data }, status);
}

function fail(
  c: AppContext,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  extra: Record<string, unknown> = {}
) {
  return c.json({ ok: false, error: { code, message, ...extra } }, status);
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/g, '');
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isSameOrigin(c: AppContext): boolean {
  const origin = c.req.header('Origin');
  if (!origin) return false;

  const requestUrl = new URL(c.req.url);
  const allowed = new Set([requestUrl.origin]);
  if (c.env.APP_ORIGIN) allowed.add(normalizeOrigin(c.env.APP_ORIGIN));
  if (isLocalHostname(requestUrl.hostname)) {
    allowed.add(requestUrl.origin);
    allowed.add('http://localhost:8787');
    allowed.add('http://127.0.0.1:8787');
  }

  return allowed.has(normalizeOrigin(origin));
}

async function readSession(c: AppContext): Promise<SessionPayload | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || !c.env.SESSION_SECRET) return null;
  return verifySession(token, c.env.SESSION_SECRET);
}

function hasValidCsrf(c: AppContext, session: SessionPayload): boolean {
  const token = c.req.header(CSRF_HEADER);
  return Boolean(token) && constantTimeEqualText(token as string, session.csrf);
}

function clientIp(c: AppContext): string {
  return c.req.header('CF-Connecting-IP') ?? 'local';
}

function setSessionCookie(c: AppContext, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000
  });
}

function clearSessionCookie(c: AppContext): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

function readPassword(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>).password;
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
}

async function readJsonBody(c: AppContext): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const declaredLength = Number(c.req.header('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: fail(c, 413, 'payload_too_large', 'Permintaan terlalu besar.')
    };
  }

  let text: string;
  try {
    text = await c.req.text();
  } catch {
    return {
      ok: false,
      response: fail(c, 400, 'invalid_request', 'Body permintaan tidak valid.')
    };
  }

  if (encoder.encode(text).byteLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: fail(c, 413, 'payload_too_large', 'Permintaan terlalu besar.')
    };
  }

  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      response: fail(c, 400, 'invalid_request', 'Body permintaan tidak valid.')
    };
  }
}

function readField(body: unknown, name: string): unknown {
  if (typeof body !== 'object' || body === null) return undefined;
  return (body as Record<string, unknown>)[name];
}

function botId(env: Env): string {
  return env.BOT_ID && /^[A-Za-z0-9_-]{1,64}$/.test(env.BOT_ID) ? env.BOT_ID : 'bot_1';
}

/** Dashboard boleh memakai sesi; daemon memakai Bearer key aktif atau sebelumnya. */
function bearerKey(c: AppContext): string | null {
  const header = c.req.header('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function isBotAuthorized(c: AppContext): boolean {
  const key = bearerKey(c);
  if (!key) return false;
  const active = c.env.BOT_API_KEY;
  const previous = c.env.BOT_API_KEY_PREVIOUS;
  return Boolean(
    (active && constantTimeEqualText(key, active)) ||
      (previous && constantTimeEqualText(key, previous))
  );
}

interface PairRow {
  id: string;
  bot_id: string;
  phone_number: string;
  code: string | null;
  status: PairStatus;
  attempts: number;
  error_code: string | null;
  created_at: number;
  code_ready_at: number | null;
  expires_at: number | null;
  completed_at: number | null;
}

/**
 * Permintaan yang sudah lewat `expires_at` dianggap final. Statusnya ditulis
 * saat dibaca agar dashboard dan daemon melihat hal yang sama, dan kode langsung
 * dihapus supaya tidak bisa dipakai lagi.
 */
async function expireStalePairRequest(c: AppContext, row: PairRow): Promise<PairRow> {
  if (!row.expires_at || row.expires_at > Date.now() || isFinalPairStatus(row.status)) return row;

  await c.env.DB.prepare(
    `UPDATE pair_requests
     SET status = 'expired', code = NULL, completed_at = ?2
     WHERE id = ?1 AND status IN ('pending','dispatched','code_ready')`
  )
    .bind(row.id, Date.now())
    .run();

  return { ...row, status: 'expired', code: null, completed_at: Date.now() };
}

async function findPairRequest(c: AppContext, id: string): Promise<PairRow | null> {
  const row = await c.env.DB.prepare(
    `SELECT id, bot_id, phone_number, code, status, attempts, error_code,
            created_at, code_ready_at, expires_at, completed_at
     FROM pair_requests WHERE id = ?1 AND bot_id = ?2`
  )
    .bind(id, botId(c.env))
    .first<PairRow>();

  return row ? expireStalePairRequest(c, row) : null;
}

/** Bentuk respons dashboard: nomor selalu ter-mask dan kode hanya saat code_ready. */
function pairPayload(row: PairRow) {
  return {
    id: row.id,
    status: row.status,
    phone_masked: maskPhone(row.phone_number),
    code: row.status === 'code_ready' ? row.code : null,
    error_code: row.error_code,
    attempts: row.attempts,
    created_at: row.created_at,
    code_ready_at: row.code_ready_at,
    expires_at: row.expires_at,
    completed_at: row.completed_at
  };
}

app.use('*', async (c, next) => {
  await next();

  const headers = new Headers(c.res.headers);
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);

  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/')) {
    headers.set('Cache-Control', 'no-store');
  } else if (path.startsWith('/assets/')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    headers.set('Cache-Control', 'no-cache');
  }

  c.res = new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers
  });
});

app.get('/api/health', async (c) => {
  let database = 'ok';
  let schema = 'unknown';

  try {
    await c.env.DB.prepare('SELECT 1 AS ok').first();
  } catch {
    return fail(c, 503, 'database_unavailable', 'Database belum siap.');
  }

  try {
    const row = await c.env.DB.prepare('SELECT MAX(version) AS version FROM schema_migrations').first<{
      version: number | null;
    }>();
    schema = (row?.version ?? 0) >= SCHEMA_VERSION ? 'ok' : 'pending';
  } catch {
    // Tabel pelacak belum ada: skema belum pernah di-bootstrap.
    schema = 'missing';
  }

  return ok(c, {
    service: 'wabot-control-plane',
    version: '0.1.0',
    status: schema === 'ok' ? 'ok' : 'degraded',
    database,
    schema,
    schema_version: SCHEMA_VERSION,
    time: Date.now()
  });
});

/**
 * Bootstrap skema. Hanya pemilik yang sudah login boleh memicunya,
 * dan hanya jika kode bootstrap memang diaktifkan lewat env.
 */
app.post('/api/admin/schema', async (c) => {
  if (!isSameOrigin(c)) {
    return fail(c, 403, 'csrf_failed', 'Origin permintaan tidak valid.');
  }

  const session = await readSession(c);
  if (!session) {
    return fail(c, 401, 'unauthorized', 'Sesi tidak valid.');
  }

  if (!hasValidCsrf(c, session)) {
    return fail(c, 403, 'csrf_failed', 'Token CSRF tidak valid.');
  }

  if (c.env.SCHEMA_BOOTSTRAP !== 'true') {
    return fail(c, 403, 'bootstrap_disabled', 'Bootstrap skema tidak diaktifkan.');
  }

  try {
    const result = await ensureSchema(c.env.DB);
    return ok(c, { from: result.from, to: result.to, applied: result.applied });
  } catch {
    return fail(c, 500, 'bootstrap_failed', 'Bootstrap skema gagal.');
  }
});

app.post('/api/auth/login', async (c) => {
  if (!isSameOrigin(c)) {
    return fail(c, 403, 'csrf_failed', 'Origin permintaan tidak valid.');
  }

  const declaredLength = Number(c.req.header('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return fail(c, 413, 'payload_too_large', 'Permintaan terlalu besar.');
  }

  let text: string;
  try {
    text = await c.req.text();
  } catch {
    return fail(c, 400, 'invalid_request', 'Body permintaan tidak valid.');
  }

  if (encoder.encode(text).byteLength > MAX_BODY_BYTES) {
    return fail(c, 413, 'payload_too_large', 'Permintaan terlalu besar.');
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(c, 400, 'invalid_request', 'Body permintaan tidak valid.');
  }

  const password = readPassword(body);
  if (!password) {
    return fail(c, 400, 'invalid_request', 'Kata sandi wajib diisi.');
  }

  // Database baru belum punya tabel rate_limits, sehingga login akan gagal sebelum
  // sempat membuat sesi. Bootstrap dijalankan lebih dulu agar tidak terjadi jalan buntu.
  if (c.env.SCHEMA_BOOTSTRAP === 'true') {
    try {
      await ensureSchema(c.env.DB);
    } catch {
      return fail(c, 500, 'bootstrap_failed', 'Bootstrap skema gagal.');
    }
  }

  let limit: Awaited<ReturnType<typeof consumeRateLimit>>;
  try {
    limit = await consumeRateLimit(c.env.DB, `login:${clientIp(c)}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  } catch {
    // Tanpa tabel rate_limits tidak ada cara membatasi percobaan, jadi jangan
    // lanjut ke pengecekan kata sandi; beri pesan yang bisa ditindaklanjuti.
    return fail(c, 503, 'schema_missing', 'Skema database belum disiapkan.');
  }

  if (!limit.allowed) {
    return fail(c, 429, 'rate_limited', 'Terlalu banyak percobaan. Coba lagi sebentar.', {
      retry_after_seconds: Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))
    });
  }

  if (!c.env.DASHBOARD_PASSWORD_HASH || !c.env.SESSION_SECRET) {
    return fail(c, 500, 'server_misconfigured', 'Konfigurasi server belum lengkap.');
  }

  if (!(await verifyPassword(password, c.env.DASHBOARD_PASSWORD_HASH))) {
    return fail(c, 401, 'invalid_credentials', 'Kata sandi salah.');
  }

  const now = Date.now();
  const session: SessionPayload = {
    sub: 'owner',
    iat: now,
    exp: now + SESSION_TTL_MS,
    csrf: randomToken(16)
  };
  const token = await signSession(session, c.env.SESSION_SECRET);
  setSessionCookie(c, token);

  return ok(c, {
    authenticated: true,
    csrf_token: session.csrf,
    expires_at: session.exp
  });
});

app.get('/api/session', async (c) => {
  const session = await readSession(c);
  if (!session) {
    return fail(c, 401, 'unauthorized', 'Sesi tidak valid.');
  }

  const id = botId(c.env);
  let bot: { status: string; last_seen_at: number | null; phone_masked: string | null } | null = null;
  let pairRequest: ReturnType<typeof pairPayload> | null = null;

  try {
    const row = await c.env.DB.prepare('SELECT status, last_seen_at, phone_jid FROM bots WHERE id = ?1')
      .bind(id)
      .first<{ status: string; last_seen_at: number | null; phone_jid: string | null }>();

    if (row) {
      bot = {
        status: row.status,
        last_seen_at: row.last_seen_at,
        phone_masked: row.phone_jid ? maskPhone(row.phone_jid.split('@')[0]) : null
      };
    }
  } catch {
    bot = null;
  }

  try {
    const open = await c.env.DB.prepare(
      `SELECT id, bot_id, phone_number, code, status, attempts, error_code,
              created_at, code_ready_at, expires_at, completed_at
       FROM pair_requests
       WHERE bot_id = ?1 AND status IN ('pending','dispatched','code_ready')
       ORDER BY created_at DESC LIMIT 1`
    )
      .bind(id)
      .first<PairRow>();

    if (open) pairRequest = pairPayload(await expireStalePairRequest(c, open));
  } catch {
    pairRequest = null;
  }

  return ok(c, {
    authenticated: true,
    csrf_token: session.csrf,
    expires_at: session.exp,
    bot,
    pair_request: pairRequest
  });
});

app.post('/api/auth/logout', async (c) => {
  if (!isSameOrigin(c)) {
    return fail(c, 403, 'csrf_failed', 'Origin permintaan tidak valid.');
  }

  const session = await readSession(c);
  if (!session) {
    return fail(c, 401, 'unauthorized', 'Sesi tidak valid.');
  }

  if (!hasValidCsrf(c, session)) {
    return fail(c, 403, 'csrf_failed', 'Token CSRF tidak valid.');
  }

  clearSessionCookie(c);
  return ok(c, { authenticated: false });
});

/* ------------------------------ pairing: dashboard ------------------------------ */

app.post('/api/pair-requests', async (c) => {
  if (!isSameOrigin(c)) {
    return fail(c, 403, 'csrf_failed', 'Origin permintaan tidak valid.');
  }

  const session = await readSession(c);
  if (!session) {
    return fail(c, 401, 'unauthorized', 'Sesi tidak valid.');
  }

  if (!hasValidCsrf(c, session)) {
    return fail(c, 403, 'csrf_failed', 'Token CSRF tidak valid.');
  }

  const parsed = await readJsonBody(c);
  if (!parsed.ok) return parsed.response;

  const phone = normalizePhone(readField(parsed.body, 'phone_number'));
  if (!phone) {
    return fail(c, 400, 'invalid_phone', 'Nomor harus digit internasional tanpa + atau spasi.');
  }

  const now = Date.now();
  const id = botId(c.env);

  const bot = await c.env.DB.prepare('SELECT status FROM bots WHERE id = ?1')
    .bind(id)
    .first<{ status: string }>();

  if (!bot) {
    return fail(c, 503, 'bot_missing', 'Baris bot belum dibuat di database.');
  }

  if (bot.status === 'connected') {
    return fail(c, 409, 'session_active', 'Bot sudah tertaut. Putuskan sesi sebelum pairing ulang.');
  }

  const open = await c.env.DB.prepare(
    `SELECT id, status, created_at, expires_at FROM pair_requests
     WHERE bot_id = ?1 AND status IN ('pending','dispatched','code_ready')
     ORDER BY created_at DESC LIMIT 1`
  )
    .bind(id)
    .first<{ id: string; status: string; created_at: number; expires_at: number | null }>();

  if (open) {
    // Permintaan lama yang sudah lewat waktu tidak boleh menahan permintaan baru.
    const stale = open.expires_at !== null && open.expires_at <= now;
    if (!stale) {
      return fail(c, 409, 'pairing_in_progress', 'Sudah ada permintaan pairing yang berjalan.', {
        pair_request_id: open.id
      });
    }

    await c.env.DB.prepare(
      `UPDATE pair_requests SET status = 'expired', code = NULL, completed_at = ?2
       WHERE id = ?1 AND status IN ('pending','dispatched','code_ready')`
    )
      .bind(open.id, now)
      .run();
  }

  const last = await c.env.DB.prepare(
    'SELECT created_at FROM pair_requests WHERE bot_id = ?1 ORDER BY created_at DESC LIMIT 1'
  )
    .bind(id)
    .first<{ created_at: number }>();

  if (last && now - last.created_at < PAIR_COOLDOWN_MS) {
    return fail(c, 429, 'pairing_cooldown', 'Tunggu 30 detik sebelum meminta kode lagi.', {
      retry_after_seconds: Math.ceil((last.created_at + PAIR_COOLDOWN_MS - now) / 1000)
    });
  }

  let limit: Awaited<ReturnType<typeof consumeRateLimit>>;
  try {
    limit = await consumeRateLimit(c.env.DB, `pair:${id}`, PAIR_LIMIT, PAIR_WINDOW_MS, now);
  } catch {
    return fail(c, 503, 'schema_missing', 'Skema database belum disiapkan.');
  }

  if (!limit.allowed) {
    return fail(c, 429, 'pairing_rate_limited', 'Maksimal 3 permintaan pairing per 15 menit.', {
      retry_after_seconds: Math.max(1, Math.ceil((limit.resetAt - now) / 1000))
    });
  }

  const requestId = `pr_${randomToken(12)}`;
  const expiresAt = now + PAIR_REQUEST_TTL_MS;

  try {
    await c.env.DB.prepare(
      `INSERT INTO pair_requests (id, bot_id, phone_number, status, attempts, created_at, expires_at)
       VALUES (?1, ?2, ?3, 'pending', 0, ?4, ?5)`
    )
      .bind(requestId, id, phone, now, expiresAt)
      .run();
  } catch {
    // Unique partial index idx_pair_open: balapan dua permintaan bersamaan.
    return fail(c, 409, 'pairing_in_progress', 'Sudah ada permintaan pairing yang berjalan.');
  }

  await c.env.DB.prepare(`UPDATE bots SET status = 'pairing', updated_at = ?2 WHERE id = ?1`)
    .bind(id, now)
    .run();

  return ok(
    c,
    {
      id: requestId,
      status: 'pending' as PairStatus,
      phone_masked: maskPhone(phone),
      expires_at: expiresAt
    },
    201
  );
});

app.get('/api/pair-requests/:id', async (c) => {
  const session = await readSession(c);
  if (!session) {
    return fail(c, 401, 'unauthorized', 'Sesi tidak valid.');
  }

  const row = await findPairRequest(c, c.req.param('id'));
  if (!row) {
    return fail(c, 404, 'not_found', 'Permintaan pairing tidak ditemukan.');
  }

  return ok(c, pairPayload(row));
});

app.post('/api/pair-requests/:id/cancel', async (c) => {
  if (!isSameOrigin(c)) {
    return fail(c, 403, 'csrf_failed', 'Origin permintaan tidak valid.');
  }

  const session = await readSession(c);
  if (!session) {
    return fail(c, 401, 'unauthorized', 'Sesi tidak valid.');
  }

  if (!hasValidCsrf(c, session)) {
    return fail(c, 403, 'csrf_failed', 'Token CSRF tidak valid.');
  }

  const row = await findPairRequest(c, c.req.param('id'));
  if (!row) {
    return fail(c, 404, 'not_found', 'Permintaan pairing tidak ditemukan.');
  }

  if (isFinalPairStatus(row.status)) {
    return fail(c, 409, 'pairing_final', 'Permintaan sudah selesai dan tidak bisa dibatalkan.');
  }

  if (!canTransition(row.status, 'cancelled')) {
    return fail(c, 409, 'invalid_transition', 'Status permintaan tidak bisa dibatalkan.');
  }

  const now = Date.now();
  await c.env.DB.prepare(
    `UPDATE pair_requests SET status = 'cancelled', code = NULL, completed_at = ?2
     WHERE id = ?1 AND status IN ('pending','dispatched','code_ready')`
  )
    .bind(row.id, now)
    .run();

  await c.env.DB.prepare(
    `UPDATE bots SET status = 'unpaired', updated_at = ?2
     WHERE id = ?1 AND status = 'pairing'`
  )
    .bind(row.bot_id, now)
    .run();

  return ok(c, { id: row.id, status: 'cancelled' as PairStatus });
});

/* -------------------------------- pairing: bot -------------------------------- */

app.use('/api/bot/*', async (c, next) => {
  if (!isBotAuthorized(c)) {
    return fail(c, 401, 'unauthorized', 'Bearer key tidak valid.');
  }

  let limit: Awaited<ReturnType<typeof consumeRateLimit>>;
  try {
    limit = await consumeRateLimit(c.env.DB, 'bot:global', BOT_LIMIT, BOT_WINDOW_MS);
  } catch {
    return fail(c, 503, 'schema_missing', 'Skema database belum disiapkan.');
  }

  if (!limit.allowed) {
    return fail(c, 429, 'bot_rate_limited', 'Batas 120 permintaan per menit terlampaui.', {
      retry_after_seconds: Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))
    });
  }

  await next();
});

app.post('/api/bot/pair-requests/claim', async (c) => {
  const now = Date.now();
  const id = botId(c.env);

  await c.env.DB.prepare(
    `UPDATE pair_requests SET status = 'expired', code = NULL, completed_at = ?2
     WHERE bot_id = ?1 AND status IN ('pending','dispatched','code_ready')
       AND expires_at IS NOT NULL AND expires_at <= ?2`
  )
    .bind(id, now)
    .run();

  const row = await c.env.DB.prepare(
    `UPDATE pair_requests
     SET status = 'dispatched', attempts = attempts + 1
     WHERE id = (
       SELECT id FROM pair_requests
       WHERE bot_id = ?1 AND status = 'pending'
       ORDER BY created_at ASC LIMIT 1
     )
     RETURNING id, phone_number, status, attempts, created_at, expires_at`
  )
    .bind(id)
    .first<{
      id: string;
      phone_number: string;
      status: PairStatus;
      attempts: number;
      created_at: number;
      expires_at: number | null;
    }>();

  if (!row) return ok(c, { request: null });

  return ok(c, {
    request: {
      id: row.id,
      phone_number: row.phone_number,
      attempts: row.attempts,
      created_at: row.created_at,
      expires_at: row.expires_at
    }
  });
});

app.post('/api/bot/pair-requests/:id/code', async (c) => {
  const parsed = await readJsonBody(c);
  if (!parsed.ok) return parsed.response;

  const code = normalizePairCode(readField(parsed.body, 'code'));
  if (!code) {
    return fail(c, 400, 'invalid_code', 'Kode harus 8 karakter alfanumerik.');
  }

  const row = await findPairRequest(c, c.req.param('id'));
  if (!row) {
    return fail(c, 404, 'not_found', 'Permintaan pairing tidak ditemukan.');
  }

  if (row.status !== 'dispatched' || !canTransition(row.status, 'code_ready')) {
    return fail(c, 409, 'invalid_transition', 'Kode hanya bisa dikirim setelah permintaan diklaim.');
  }

  const now = Date.now();
  const expiresAt = now + PAIR_CODE_TTL_MS;

  const updated = await c.env.DB.prepare(
    `UPDATE pair_requests
     SET status = 'code_ready', code = ?2, code_ready_at = ?3, expires_at = ?4
     WHERE id = ?1 AND status = 'dispatched'
     RETURNING id, status, expires_at`
  )
    .bind(row.id, code, now, expiresAt)
    .first<{ id: string; status: PairStatus; expires_at: number }>();

  if (!updated) {
    return fail(c, 409, 'invalid_transition', 'Permintaan berubah sebelum kode tersimpan.');
  }

  return ok(c, { id: updated.id, status: updated.status, expires_at: updated.expires_at });
});

app.post('/api/bot/pair-requests/:id/status', async (c) => {
  const parsed = await readJsonBody(c);
  if (!parsed.ok) return parsed.response;

  const status = readField(parsed.body, 'status');
  if (status !== 'connected' && status !== 'failed') {
    return fail(c, 400, 'invalid_request', 'Status harus connected atau failed.');
  }

  const row = await findPairRequest(c, c.req.param('id'));
  if (!row) {
    return fail(c, 404, 'not_found', 'Permintaan pairing tidak ditemukan.');
  }

  if (row.status !== 'code_ready' || !canTransition(row.status, status)) {
    return fail(c, 409, 'invalid_transition', 'Status hanya bisa diubah dari code_ready.');
  }

  const now = Date.now();

  if (status === 'connected') {
    const phoneJid = readField(parsed.body, 'phone_jid');
    if (typeof phoneJid !== 'string' || !/^[1-9]\d{7,14}@s\.whatsapp\.net$/.test(phoneJid)) {
      return fail(c, 400, 'invalid_request', 'phone_jid tidak valid.');
    }

    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE pair_requests SET status = 'connected', code = NULL, completed_at = ?2
         WHERE id = ?1 AND status = 'code_ready'`
      ).bind(row.id, now),
      c.env.DB.prepare(
        `UPDATE bots SET status = 'connected', phone_jid = ?2, paired_at = ?3, updated_at = ?3
         WHERE id = ?1`
      ).bind(row.bot_id, phoneJid, now)
    ]);

    return ok(c, { id: row.id, status: 'connected' as PairStatus });
  }

  const errorCode = readField(parsed.body, 'error_code');
  const normalizedError =
    typeof errorCode === 'string' && (BOT_ERROR_CODES as readonly string[]).includes(errorCode)
      ? errorCode
      : 'code_invalid';

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE pair_requests SET status = 'failed', code = NULL, error_code = ?2, completed_at = ?3
       WHERE id = ?1 AND status = 'code_ready'`
    ).bind(row.id, normalizedError, now),
    c.env.DB.prepare(
      `UPDATE bots SET status = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'pairing'`
    ).bind(row.bot_id, normalizedError === 'logged_out' ? 'logged_out' : 'unpaired', now)
  ]);

  return ok(c, { id: row.id, status: 'failed' as PairStatus, error_code: normalizedError });
});

app.notFound(async (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/')) {
    return fail(c, 404, 'not_found', 'Endpoint tidak ditemukan.');
  }

  const requestUrl = new URL(c.req.url);
  let asset = await c.env.ASSETS.fetch(c.req.raw);

  if (asset.status === 404 && c.req.method === 'GET' && !/\.[a-zA-Z0-9]+$/.test(requestUrl.pathname)) {
    asset = await c.env.ASSETS.fetch(
      new Request(new URL('/index.html', requestUrl), {
        method: 'GET',
        headers: c.req.raw.headers
      })
    );
  }

  return asset;
});

app.onError((error, c) => {
  console.error('worker_error', error instanceof Error ? error.name : 'unknown');
  return fail(c, 500, 'internal_error', 'Terjadi kesalahan internal.');
});

export { app };
export default { fetch: app.fetch };
