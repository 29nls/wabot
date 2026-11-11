import { describe, expect, it } from 'vitest';
import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import { signSession } from './auth';
import { app, type Env } from './worker';

/**
 * Uji ofensif level route: BOLA/IDOR, SQLi, dan XSS pada endpoint pairing
 * dan bot. D1 palsu mensimulasikan scoping `bot_id = ?` seperti database
 * asli, sehingga tes berjalan di `npm test` tanpa server workerd.
 */

const SECRET = 'secret-yang-cukup-panjang';
const CSRF = 'csrf-token-uji';
const BOT_KEY = 'bot-key-uji-yang-panjang';
const ORIGIN = { Origin: 'http://localhost' };
const FOREIGN_ID = 'pr_bola_foreign_1';
const OWN_CODE_READY_ID = 'pr_bola_code_ready';

interface FakeCall {
  sql: string;
  params: unknown[];
}

interface FakeDb {
  db: D1Database;
  calls: FakeCall[];
}

const NOW = Date.now();
const ROWS = [
  {
    id: FOREIGN_ID,
    bot_id: 'bot_other',
    phone_number: '628999999999',
    code: null,
    status: 'pending',
    attempts: 0,
    error_code: null,
    created_at: NOW,
    code_ready_at: null,
    expires_at: NOW + 600_000,
    completed_at: null
  },
  {
    id: OWN_CODE_READY_ID,
    bot_id: 'bot_1',
    phone_number: '628111222333',
    code: 'TESTCODE',
    status: 'code_ready',
    attempts: 1,
    error_code: null,
    created_at: NOW,
    code_ready_at: NOW,
    expires_at: NOW + 600_000,
    completed_at: null
  }
];

function securityDb(): FakeDb {
  const calls: FakeCall[] = [];

  function resolveFirst(sql: string, params: unknown[]): unknown {
    if (sql.includes('SELECT session_version FROM bots')) return { session_version: 0 };

    if (sql.includes('INSERT INTO rate_limits')) {
      const windowStart = Number(params[1] ?? Date.now());
      return { count: 1, window_start: windowStart, expires_at: windowStart + 60_000 };
    }

    // Query scoped milik findPairRequest: hanya mengembalikan baris milik bot pemanggil.
    if (sql.includes('FROM pair_requests WHERE id = ?1 AND bot_id = ?2')) {
      const [id, botId] = params as string[];
      const row = ROWS.find((candidate) => candidate.id === id && candidate.bot_id === botId);
      return row ? { ...row } : null;
    }

    if (sql.includes('SELECT status, last_seen_at, phone_jid FROM bots')) return null;
    if (sql.includes('SELECT status FROM bots')) return { status: 'unpaired' };

    return null;
  }

  const db = {
    prepare(sql: string) {
      const call: FakeCall = { sql, params: [] };
      calls.push(call);

      const statement = {
        bind(...params: unknown[]) {
          call.params = params;
          return statement;
        },
        async first() {
          return (resolveFirst(sql, call.params) ?? null) as never;
        },
        async run() {
          return { success: true } as never;
        },
        async all() {
          return { results: [] } as never;
        }
      };

      return statement;
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  } as unknown as D1Database;

  return { db, calls };
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    DASHBOARD_PASSWORD_HASH: 'pbkdf2$100000$c2FsdA$aGFzaA',
    SESSION_SECRET: SECRET,
    BOT_API_KEY: BOT_KEY
  };
}

async function sessionCookie(sessionVersion = 0): Promise<string> {
  const now = Date.now();
  const token = await signSession(
    { sub: 'owner', iat: now, exp: now + 60_000, csrf: CSRF, session_version: sessionVersion },
    SECRET
  );
  return `wabot_session=${token}`;
}

const LEAK_PATTERNS = [/SQLITE/i, /syntax error/i, /UNION/i, /DatabaseError/i, /stack/i, /at Object\./i];

function expectNoLeak(text: string): void {
  for (const pattern of LEAK_PATTERNS) expect(text).not.toMatch(pattern);
}

function dashboardHeaders(cookie: string): Record<string, string> {
  return { ...ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF, Cookie: cookie };
}

function botHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${BOT_KEY}`, 'Content-Type': 'application/json' };
}

describe('uji ofensif BOLA/IDOR', () => {
  it('menolak GET pair request milik bot lain tanpa membocorkan nomor', async () => {
    const response = await app.request(
      `/api/pair-requests/${FOREIGN_ID}`,
      { headers: { Cookie: await sessionCookie() } },
      makeEnv(securityDb().db)
    );
    const text = await response.text();

    expect(response.status).toBe(404);
    expect(text).not.toContain('628999999999');
    expectNoLeak(text);
  });

  it('menolak cancel pair request milik bot lain', async () => {
    const response = await app.request(
      `/api/pair-requests/${FOREIGN_ID}/cancel`,
      { method: 'POST', headers: dashboardHeaders(await sessionCookie()), body: '{}' },
      makeEnv(securityDb().db)
    );
    const text = await response.text();

    expect(response.status).toBe(404);
    expect(text).not.toContain('628999999999');
  });

  it('menolak endpoint bot pada pair request milik bot lain', async () => {
    const env = makeEnv(securityDb().db);

    const codeResponse = await app.request(
      `/api/bot/pair-requests/${FOREIGN_ID}/code`,
      { method: 'POST', headers: botHeaders(), body: JSON.stringify({ code: 'ABCD1234' }) },
      env
    );
    expect(codeResponse.status).toBe(404);
    expect(await codeResponse.text()).not.toContain('628999999999');

    const statusResponse = await app.request(
      `/api/bot/pair-requests/${FOREIGN_ID}/status`,
      {
        method: 'POST',
        headers: botHeaders(),
        body: JSON.stringify({ status: 'connected', phone_jid: '628123456789@s.whatsapp.net' })
      },
      env
    );
    expect(statusResponse.status).toBe(404);
    expect(await statusResponse.text()).not.toContain('628999999999');
  });

  it('tidak menemukan ID tebakan, override query, atau traversal path', async () => {
    const env = makeEnv(securityDb().db);
    const paths = [
      '/api/pair-requests/pr_deadbeefcafe',
      `/api/pair-requests/${FOREIGN_ID}?bot_id=bot_other`,
      '/api/pair-requests/..%2F..%2Fetc%2Fpasswd'
    ];

    for (const path of paths) {
      const response = await app.request(path, { headers: { Cookie: await sessionCookie() } }, env);
      expect(response.status).toBe(404);
      expectNoLeak(await response.text());
    }
  });

  it('mengabaikan override header X-Bot-Id', async () => {
    const response = await app.request(
      `/api/pair-requests/${FOREIGN_ID}`,
      { headers: { Cookie: await sessionCookie(), 'X-Bot-Id': 'bot_other' } },
      makeEnv(securityDb().db)
    );

    expect(response.status).toBe(404);
  });

  it('menolak claim tanpa Bearer key dan dengan key palsu', async () => {
    const env = makeEnv(securityDb().db);
    const attempts: Array<Record<string, string>> = [
      { 'Content-Type': 'application/json' },
      { Authorization: 'Bearer forged-key-123', 'Content-Type': 'application/json' }
    ];

    for (const headers of attempts) {
      const response = await app.request(
        '/api/bot/pair-requests/claim',
        { method: 'POST', headers, body: '{}' },
        env
      );
      expect(response.status).toBe(401);
    }
  });

  it('claim dengan key sah tidak pernah mengembalikan request bot lain', async () => {
    const response = await app.request(
      '/api/bot/pair-requests/claim',
      { method: 'POST', headers: botHeaders(), body: '{}' },
      makeEnv(securityDb().db)
    );
    const body = (await response.json()) as { data: { request: { id: string } | null } };

    expect(response.status).toBe(200);
    expect(body.data.request).toBeNull();
  });
});

describe('uji ofensif SQLi', () => {
  const PHONE_PAYLOADS = [
    "628123456789' OR '1'='1",
    '628123456789; DROP TABLE pair_requests;--',
    "' UNION SELECT id, bot_id, phone_number, code, status, attempts, error_code, created_at, code_ready_at, expires_at, completed_at FROM pair_requests--",
    "628123456789' AND 1=1--",
    '" OR ""="'
  ];

  it.each(PHONE_PAYLOADS)('menolak payload SQLi pada phone_number: %s', async (payload) => {
    const fake = securityDb();
    const response = await app.request(
      '/api/pair-requests',
      {
        method: 'POST',
        headers: dashboardHeaders(await sessionCookie()),
        body: JSON.stringify({ phone_number: payload })
      },
      makeEnv(fake.db)
    );
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).not.toContain(payload);
    expectNoLeak(text);
    expect(fake.calls.filter((call) => call.sql.includes('INSERT INTO pair_requests'))).toHaveLength(0);
  });

  it.each(["pr_1' OR '1'='1", 'pr_1; DROP TABLE bots;--', '1 UNION SELECT 1'])(
    'tidak mengeksekusi payload SQLi pada path id: %s',
    async (payload) => {
      const response = await app.request(
        '/api/pair-requests/' + encodeURIComponent(payload),
        { headers: { Cookie: await sessionCookie() } },
        makeEnv(securityDb().db)
      );

      expect(response.status).toBe(404);
      expectNoLeak(await response.text());
    }
  );

  it.each(["' OR 1=1--", "ABCD1234'--", '<script>alert(1)</script>'])(
    'menolak payload pada kode bot: %s',
    async (payload) => {
      const response = await app.request(
        '/api/bot/pair-requests/pr_x/code',
        { method: 'POST', headers: botHeaders(), body: JSON.stringify({ code: payload }) },
        makeEnv(securityDb().db)
      );
      const text = await response.text();

      expect(response.status).toBe(400);
      expect(text).not.toContain(payload);
      expectNoLeak(text);
    }
  );

  it('menolak nilai status yang mengandung SQLi', async () => {
    const response = await app.request(
      '/api/bot/pair-requests/pr_x/status',
      {
        method: 'POST',
        headers: botHeaders(),
        body: JSON.stringify({ status: "connected'; DROP TABLE bots;--" })
      },
      makeEnv(securityDb().db)
    );

    expect(response.status).toBe(400);
    expectNoLeak(await response.text());
  });

  it('menolak phone_jid berisi SQLi pada request milik sendiri', async () => {
    const response = await app.request(
      `/api/bot/pair-requests/${OWN_CODE_READY_ID}/status`,
      {
        method: 'POST',
        headers: botHeaders(),
        body: JSON.stringify({ status: 'connected', phone_jid: "628123456789@s.whatsapp.net' OR '1'='1" })
      },
      makeEnv(securityDb().db)
    );

    expect(response.status).toBe(400);
    expectNoLeak(await response.text());
  });

  it('menolak cookie sesi berisi injeksi SQL', async () => {
    const response = await app.request(
      '/api/session',
      { headers: { Cookie: "wabot_session=' OR '1'='1" } },
      makeEnv(securityDb().db)
    );

    expect(response.status).toBe(401);
    expectNoLeak(await response.text());
  });

  it('menolak password login berisi injeksi SQL', async () => {
    const response = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { ...ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: "' OR '1'='1' --" })
      },
      makeEnv(securityDb().db)
    );

    expect(response.status).toBe(401);
    expectNoLeak(await response.text());
  });

  it('menolak JSON rusak tanpa membocorkan detail internal', async () => {
    const response = await app.request(
      '/api/pair-requests',
      {
        method: 'POST',
        headers: dashboardHeaders(await sessionCookie()),
        body: '{"phone_number":'
      },
      makeEnv(securityDb().db)
    );

    expect(response.status).toBe(400);
    expectNoLeak(await response.text());
  });
});

describe('uji ofensif XSS', () => {
  const XSS = '<script>alert(1)</script>';

  it('tidak merefleksikan payload XSS pada phone_number', async () => {
    const response = await app.request(
      '/api/pair-requests',
      {
        method: 'POST',
        headers: dashboardHeaders(await sessionCookie()),
        body: JSON.stringify({ phone_number: '62812' + XSS })
      },
      makeEnv(securityDb().db)
    );
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).not.toContain(XSS);
    expect(response.headers.get('content-type') ?? '').toContain('application/json');
  });

  it('tidak merefleksikan payload XSS pada path dashboard dan bot', async () => {
    const env = makeEnv(securityDb().db);
    const encoded = encodeURIComponent(XSS);

    const dashboardResponse = await app.request(
      '/api/pair-requests/' + encoded,
      { headers: { Cookie: await sessionCookie() } },
      env
    );
    expect(dashboardResponse.status).toBe(404);
    expect(await dashboardResponse.text()).not.toContain(XSS);

    const botResponse = await app.request(
      '/api/bot/pair-requests/' + encoded + '/code',
      { method: 'POST', headers: botHeaders(), body: JSON.stringify({ code: 'ABCDEFGH' }) },
      env
    );
    expect(botResponse.status).toBe(404);
    expect(await botResponse.text()).not.toContain(XSS);
  });

  it('mengabaikan field tambahan berisi HTML', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    const response = await app.request(
      '/api/pair-requests',
      {
        method: 'POST',
        headers: dashboardHeaders(await sessionCookie()),
        body: JSON.stringify({ phone_number: '0812 3456', extra: payload })
      },
      makeEnv(securityDb().db)
    );
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).not.toContain(payload);
  });

  it('tidak merefleksikan path pada fallback SPA', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    const response = await app.request(
      '/' + encodeURIComponent(payload),
      {},
      makeEnv(securityDb().db)
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain(payload);
  });

  it('memasang header pertahanan XSS pada respons API', async () => {
    const response = await app.request('/api/health', {}, makeEnv(securityDb().db));
    const csp = response.headers.get('content-security-policy') ?? '';

    expect(response.status).toBe(200);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-type') ?? '').toContain('application/json');
  });
});

describe('heartbeat bot', () => {
  it('menerima heartbeat Bearer valid dan memperbarui baris bot', async () => {
    const fake = securityDb();
    const response = await app.request(
      '/api/bot/heartbeat',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${BOT_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'connected', app_version: '0.1.0' })
      },
      makeEnv(fake.db)
    );

    expect(response.status).toBe(200);
    const update = fake.calls.find((call) => call.sql.includes('UPDATE bots SET status = COALESCE'));
    expect(update?.params[0]).toBe('bot_1');
    expect(update?.params[1]).toBe('connected');
    expect(update?.params[3]).toBe('0.1.0');
  });

  it('menolak heartbeat tanpa Bearer dan status yang tidak dikenal', async () => {
    const noKey = await app.request(
      '/api/bot/heartbeat',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      makeEnv(securityDb().db)
    );
    expect(noKey.status).toBe(401);

    const badStatus = await app.request(
      '/api/bot/heartbeat',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${BOT_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'hacked' })
      },
      makeEnv(securityDb().db)
    );
    expect(badStatus.status).toBe(400);
  });
});
