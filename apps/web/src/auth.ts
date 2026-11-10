import type { D1Database } from '@cloudflare/workers-types';

export interface SessionPayload {
  sub: 'owner';
  iat: number;
  exp: number;
  csrf: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

export function constantTimeEqualText(a: string, b: string): boolean {
  return constantTimeEqual(encoder.encode(a), encoder.encode(b));
}

export function randomToken(byteLength = 16): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return new Uint8Array(bits);
}

// Cloudflare Workers menolak deriveBits PBKDF2 di atas 100.000 iterasi, jadi hash
// yang dibuat harus memakai batas itu agar bisa diverifikasi di runtime.
export async function hashPassword(password: string, iterations = 100000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, iterations);
  return `pbkdf2$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    const parts = encoded.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) return false;

    const salt = fromBase64Url(parts[2]);
    const expected = fromBase64Url(parts[3]);
    if (salt.length === 0 || expected.length === 0) return false;

    const actual = await derivePassword(password, salt, iterations);
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify'
  ]);
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySession(
  token: string,
  secret: string,
  now = Date.now()
): Promise<SessionPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [body, signature] = parts;
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(signature),
      encoder.encode(body)
    );
    if (!valid) return null;

    const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
    if (!isSessionPayload(parsed)) return null;
    if (parsed.exp <= now) return null;

    return parsed;
  } catch {
    return null;
  }
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.sub === 'owner' &&
    typeof candidate.iat === 'number' &&
    typeof candidate.exp === 'number' &&
    typeof candidate.csrf === 'string' &&
    candidate.csrf.length > 0
  );
}

interface RateLimitRow {
  count: number;
  window_start: number;
  expires_at: number;
}

export async function consumeRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): Promise<RateLimitResult> {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count, expires_at)
       VALUES (?1, ?2, 1, ?3)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start > ?4 THEN rate_limits.count + 1 ELSE 1 END,
         window_start = CASE WHEN rate_limits.window_start > ?4 THEN rate_limits.window_start ELSE ?2 END,
         expires_at = CASE WHEN rate_limits.window_start > ?4 THEN rate_limits.expires_at ELSE ?3 END
       RETURNING count, window_start, expires_at`
    )
    .bind(key, now, now + windowMs, now - windowMs)
    .first<RateLimitRow>();

  if (!row) throw new Error('rate limit insert returned no row');

  return {
    allowed: row.count <= limit,
    remaining: Math.max(0, limit - row.count),
    resetAt: row.window_start + windowMs
  };
}
