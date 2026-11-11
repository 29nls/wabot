import { describe, expect, it } from 'vitest';
import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import { signSession } from './auth';
import { app, type Env } from './worker';

type Handler = (sql: string, params: unknown[]) => unknown;

interface FakeDb {
  db: D1Database;
  calls: Array<{ sql: string; params: unknown[] }>;
}

/**
 * D1 palsu yang memilih hasil per-SQL. Cukup untuk menguji urutan query dan
 * bentuk respons tanpa meniru seluruh SQLite.
 */
function fakeDb(handler: Handler = () => null): FakeDb {
  const calls: Array<{ sql: string; params: unknown[] }> = [];

  const db = {
    prepare(sql: string) {
      const call = { sql, params: [] as unknown[] };
      calls.push(call);

      const statement = {
        bind(...params: unknown[]) {
          call.params = params;
          return statement;
        },
        async first() {
          const result = (handler(sql, call.params) ?? null) as never;
          if (result === null && sql.includes('SELECT session_version FROM bots')) return { session_version: 0 } as never;
          return result;
        },
        async run() {
          handler(sql, call.params);
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

function makeEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    DASHBOARD_PASSWORD_HASH: 'pbkdf2$100000$c2FsdA$aGFzaA',
    SESSION_SECRET: 'secret-yang-cukup-panjang',
    ...overrides
  };
}

const SECRET = 'secret-yang-cukup-panjang';
const CSRF = 'csrf-token-uji';

async function sessionCookie(sessionVersion = 0): Promise<string> {
  const now = Date.now();
  const token = await signSession({ sub: 'owner', iat: now, exp: now + 60_000, csrf: CSRF, session_version: sessionVersion }, SECRET);
  return `wabot_session=${token}`;
}

const ORIGIN = { Origin: 'http://localhost' };

describe('pairing dashboard routes', () => {
  it('rejects a request from a foreign origin', async () => {
    const response = await app.request(
      '/api/pair-requests',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Cookie: await sessionCookie(), 'X-CSRF-Token': CSRF },
        body: JSON.stringify({ phone_number: '628123456789' })
      },
      makeEnv(fakeDb().db)
    );

    expect(response.status).toBe(403);
  });

  it('rejects a request without a session', async () => {
    const response = await app.request(
      '/api/pair-requests',
      {
        method: 'POST',
        headers: { ...ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
        body: JSON.stringify({ phone_number: '628123456789' })
      },
      makeEnv(fakeDb().db)
    );

    expect(response.status).toBe(401);
  });

  it('rejects a request without a valid CSRF token', async () => {
    const response = await app.request(
      '/api/pair-requests',
      {
        method: 'POST',
        headers: { ...ORIGIN, 'Content-Type': 'application/json', Cookie: await sessionCookie() },
        body: JSON.stringify({ phone_number: '628123456789' })
      },
      makeEnv(fakeDb().db)
    );

    expect(response.status).toBe(403);
  });

  it('rejects a malformed phone number before touching the bot row', async () => {
    const fake = fakeDb();
    const response = await app.request(
      '/api/pair-requests',
      {
        method: 'POST',
        headers: { ...ORIGIN, 'Content-Type': 'application/json', Cookie: await sessionCookie(), 'X-CSRF-Token': CSRF },
        body: JSON.stringify({ phone_number: '0812 3456' })
      },
      makeEnv(fake.db)
    );

    expect(response.status).toBe(400);
    expect(fake.calls.filter((call) => call.sql.includes('pair_requests'))).toHaveLength(0);
  });

  it('requires a session to read a pair request', async () => {
    const response = await app.request('/api/pair-requests/pr_1', {}, makeEnv(fakeDb().db));

    expect(response.status).toBe(401);
  });

  it('hides a pair request that belongs to another bot', async () => {
    const fake = fakeDb(() => null);
    const response = await app.request(
      '/api/pair-requests/pr_1',
      { headers: { Cookie: await sessionCookie() } },
      makeEnv(fake.db)
    );

    expect(response.status).toBe(404);
    const select = fake.calls.find((call) => call.sql.includes('FROM pair_requests WHERE id'));
    expect(select?.params).toEqual(['pr_1', 'bot_1']);
  });

  it('membatalkan sesi yang sudah disalin setelah logout (cookie lama 401)', async () => {
    let dbVersion = 0;
    const fake = fakeDb((sql) => {
      if (sql.includes('SELECT session_version FROM bots')) return { session_version: dbVersion };
      if (sql.includes("UPDATE bots SET session_version")) {
        dbVersion += 1;
        return null;
      }
      return null;
    });

    const cookie = await sessionCookie(0);

    const before = await app.request('/api/session', { headers: { Cookie: cookie } }, makeEnv(fake.db));
    expect(before.status).toBe(200);

    const logout = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { ...ORIGIN, 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': CSRF }
    }, makeEnv(fake.db));
    expect(logout.status).toBe(200);

    const after = await app.request('/api/session', { headers: { Cookie: cookie } }, makeEnv(fake.db));
    expect(after.status).toBe(401);
  });

  it('logout dari semua perangkat menaikkan session_version dan mencabut cookie lama', async () => {
    let dbVersion = 0;
    const fake = fakeDb((sql) => {
      if (sql.includes('SELECT session_version FROM bots')) return { session_version: dbVersion };
      if (sql.includes('UPDATE bots SET session_version')) {
        dbVersion += 1;
        return null;
      }
      return null;
    });

    const cookie = await sessionCookie(0);

    const response = await app.request(
      '/api/auth/logout-all',
      {
        method: 'POST',
        headers: { ...ORIGIN, 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': CSRF }
      },
      makeEnv(fake.db)
    );

    expect(response.status).toBe(200);
    expect(dbVersion).toBe(1);

    const after = await app.request('/api/session', { headers: { Cookie: cookie } }, makeEnv(fake.db));
    expect(after.status).toBe(401);
  });

  it('logout dari semua perangkat menolak tanpa CSRF atau tanpa sesi', async () => {
    const fake = fakeDb();
    const cookie = await sessionCookie();

    const noCsrf = await app.request(
      '/api/auth/logout-all',
      { method: 'POST', headers: { ...ORIGIN, 'Content-Type': 'application/json', Cookie: cookie } },
      makeEnv(fake.db)
    );
    expect(noCsrf.status).toBe(403);

    const noSession = await app.request(
      '/api/auth/logout-all',
      { method: 'POST', headers: { ...ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF } },
      makeEnv(fake.db)
    );
    expect(noSession.status).toBe(401);
  });

  it('masks the phone number and hides the code until it is ready', async () => {
    const row = {
      id: 'pr_1',
      bot_id: 'bot_1',
      phone_number: '628123456789',
      code: 'ABCDEFGH',
      status: 'dispatched',
      attempts: 1,
      error_code: null,
      created_at: Date.now(),
      code_ready_at: null,
      expires_at: Date.now() + 60_000,
      completed_at: null
    };

    const response = await app.request(
      '/api/pair-requests/pr_1',
      { headers: { Cookie: await sessionCookie() } },
      makeEnv(fakeDb((sql) => (sql.includes('FROM pair_requests WHERE id') ? row : null)).db)
    );
    const body = (await response.json()) as { data: { phone_masked: string; code: string | null } };

    expect(response.status).toBe(200);
    expect(body.data.phone_masked).toBe('62812••••789');
    expect(body.data.code).toBeNull();
  });
});

function rateLimitDb(extra: Handler = () => null): FakeDb {
  return fakeDb((sql, params) => {
    if (sql.includes('rate_limits')) {
      return {
        count: 1,
        window_start: Number(params[1] ?? Date.now()),
        expires_at: Number(params[2] ?? Date.now() + 60_000)
      };
    }

    return extra(sql, params);
  });
}

const CODE_READY_ROW = {
  id: 'pr_1',
  bot_id: 'bot_1',
  phone_number: '628123456789',
  code: 'ABCDEFGH',
  status: 'code_ready',
  attempts: 1,
  error_code: null,
  created_at: Date.now(),
  code_ready_at: Date.now(),
  expires_at: Date.now() + 60_000,
  completed_at: null
};

describe('pairing bot authorization', () => {
  it('rejects a missing bearer key', async () => {
    const response = await app.request('/api/bot/pair-requests/claim', { method: 'POST' }, makeEnv(fakeDb().db));

    expect(response.status).toBe(401);
  });

  it('rejects a wrong bearer key', async () => {
    const response = await app.request(
      '/api/bot/pair-requests/claim',
      { method: 'POST', headers: { Authorization: 'Bearer salah' } },
      makeEnv(fakeDb().db, { BOT_API_KEY: 'kunci-aktif' })
    );

    expect(response.status).toBe(401);
  });

  it('rejects bot routes when no key is configured', async () => {
    const response = await app.request(
      '/api/bot/pair-requests/claim',
      { method: 'POST', headers: { Authorization: 'Bearer apa-saja' } },
      makeEnv(fakeDb().db)
    );

    expect(response.status).toBe(401);
  });

  it('accepts the active and the previous key', async () => {
    for (const key of ['kunci-baru', 'kunci-lama']) {
      const response = await app.request(
        '/api/bot/pair-requests/claim',
        { method: 'POST', headers: { Authorization: `Bearer ${key}` } },
        makeEnv(rateLimitDb().db, { BOT_API_KEY: 'kunci-baru', BOT_API_KEY_PREVIOUS: 'kunci-lama' })
      );

      expect(response.status).toBe(200);
    }
  });

  it('does not expose CORS headers on rejected bot calls', async () => {
    const response = await app.request('/api/bot/pair-requests/claim', { method: 'POST' }, makeEnv(fakeDb().db));

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns an empty claim when nothing is pending', async () => {
    const response = await app.request(
      '/api/bot/pair-requests/claim',
      { method: 'POST', headers: { Authorization: 'Bearer kunci' } },
      makeEnv(rateLimitDb().db, { BOT_API_KEY: 'kunci' })
    );
    const body = (await response.json()) as { data: { request: unknown } };

    expect(response.status).toBe(200);
    expect(body.data.request).toBeNull();
  });

  it('returns 429 when the global bot limit is exceeded', async () => {
    const fake = fakeDb((sql, params) => {
      if (sql.includes('rate_limits')) {
        return { count: 121, window_start: Number(params[1]), expires_at: Number(params[2]) };
      }
      return null;
    });

    const response = await app.request(
      '/api/bot/pair-requests/claim',
      { method: 'POST', headers: { Authorization: 'Bearer kunci' } },
      makeEnv(fake.db, { BOT_API_KEY: 'kunci' })
    );
    const body = (await response.json()) as { error: { code: string; retry_after_seconds: number } };

    expect(response.status).toBe(429);
    expect(body.error.code).toBe('bot_rate_limited');
    expect(body.error.retry_after_seconds).toBeGreaterThan(0);
  });
});

describe('pairing bot transitions', () => {
  it('rejects a pair code that is not 8 alphanumeric characters', async () => {
    const response = await app.request(
      '/api/bot/pair-requests/pr_1/code',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer kunci', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'ABC' })
      },
      makeEnv(rateLimitDb().db, { BOT_API_KEY: 'kunci' })
    );

    expect(response.status).toBe(400);
  });

  it('refuses a code for a request that has not been claimed', async () => {
    const pending = { ...CODE_READY_ROW, status: 'pending', code: null };

    const response = await app.request(
      '/api/bot/pair-requests/pr_1/code',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer kunci', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'ABCD-EFGH' })
      },
      makeEnv(rateLimitDb((sql) => (sql.includes('FROM pair_requests WHERE id') ? pending : null)).db, {
        BOT_API_KEY: 'kunci'
      })
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('invalid_transition');
  });

  it('stores a normalized code for a dispatched request', async () => {
    const dispatched = { ...CODE_READY_ROW, status: 'dispatched', code: null };
    const fake = rateLimitDb((sql, params) => {
      if (sql.includes('FROM pair_requests WHERE id')) return dispatched;
      if (sql.includes("SET status = 'code_ready'")) {
        return { id: 'pr_1', status: 'code_ready', expires_at: Number(params[3]) };
      }
      return null;
    });

    const response = await app.request(
      '/api/bot/pair-requests/pr_1/code',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer kunci', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'abcd-efgh' })
      },
      makeEnv(fake.db, { BOT_API_KEY: 'kunci' })
    );
    const body = (await response.json()) as { data: { status: string } };

    expect(response.status).toBe(200);
    expect(body.data.status).toBe('code_ready');
    const update = fake.calls.find((call) => call.sql.includes("SET status = 'code_ready'"));
    expect(update?.params[1]).toBe('ABCDEFGH');
  });

  it('accepts only connected or failed in the status endpoint', async () => {
    const response = await app.request(
      '/api/bot/pair-requests/pr_1/status',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer kunci', 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'expired' })
      },
      makeEnv(rateLimitDb().db, { BOT_API_KEY: 'kunci' })
    );

    expect(response.status).toBe(400);
  });

  it('requires a valid phone_jid when reporting connected', async () => {
    const response = await app.request(
      '/api/bot/pair-requests/pr_1/status',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer kunci', 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'connected', phone_jid: 'bukan-jid' })
      },
      makeEnv(rateLimitDb((sql) => (sql.includes('FROM pair_requests WHERE id') ? CODE_READY_ROW : null)).db, {
        BOT_API_KEY: 'kunci'
      })
    );

    expect(response.status).toBe(400);
  });
});
