import { describe, expect, it } from 'vitest';
import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import { app, type Env } from './worker';

function fakeDb(result: unknown = { ok: 1 }, throws = false): D1Database {
  return {
    prepare: () => ({
      first: async () => {
        if (throws) throw new Error('database down');
        return result;
      },
      bind: () => ({
        first: async () => {
          if (throws) throw new Error('database down');
          return result;
        }
      })
    })
  } as unknown as D1Database;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: fakeDb(),
    ASSETS: {
      fetch: async () => new Response('asset')
    } as unknown as Fetcher,
    DASHBOARD_PASSWORD_HASH: 'pbkdf2$100000$c2FsdA$aGFzaA',
    SESSION_SECRET: 'secret-yang-cukup-panjang',
    APP_ORIGIN: 'http://localhost:8787',
    ...overrides
  };
}

describe('worker routes', () => {
  it('returns health with security and cache headers', async () => {
    const response = await app.request('/api/health', {}, makeEnv());
    const body = (await response.json()) as { ok: boolean; data: { database: string } };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.database).toBe('ok');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
  });

  it('returns 503 when D1 is unavailable', async () => {
    const response = await app.request('/api/health', {}, makeEnv({ DB: fakeDb(undefined, true) }));

    expect(response.status).toBe(503);
  });

  it('rejects login without a same-origin header', async () => {
    const response = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'uji' })
      },
      makeEnv()
    );

    expect(response.status).toBe(403);
  });

  it('rejects login when APP_ORIGIN is not set but Origin is foreign', async () => {
    const response = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
        body: JSON.stringify({ password: 'uji' })
      },
      makeEnv({ APP_ORIGIN: undefined })
    );

    expect(response.status).toBe(403);
  });

  it('rejects malformed login bodies', async () => {
    const response = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8787' },
        body: '{'
      },
      makeEnv()
    );

    expect(response.status).toBe(400);
  });

  it('requires a session for the session endpoint', async () => {
    const response = await app.request('/api/session', {}, makeEnv());

    expect(response.status).toBe(401);
  });

  it('reports pending schema without failing health', async () => {
    const db = {
      prepare: (sql: string) => ({
        first: async () => {
          if (sql.includes('schema_migrations')) throw new Error('no such table');
          return { ok: 1 };
        }
      })
    } as unknown as D1Database;

    const response = await app.request('/api/health', {}, makeEnv({ DB: db }));
    const body = (await response.json()) as {
      data: { status: string; schema: string; schema_version: number };
    };

    expect(response.status).toBe(200);
    expect(body.data.status).toBe('degraded');
    expect(body.data.schema).toBe('missing');
    expect(body.data.schema_version).toBe(3);
  });

  it('rejects schema bootstrap without a session', async () => {
    const response = await app.request(
      '/api/admin/schema',
      { method: 'POST', headers: { Origin: 'http://localhost:8787' } },
      makeEnv({ SCHEMA_BOOTSTRAP: 'true' })
    );

    expect(response.status).toBe(401);
  });

  it('rejects schema bootstrap when the feature flag is off', async () => {
    const response = await app.request(
      '/api/admin/schema',
      { method: 'POST', headers: { Origin: 'http://localhost:8787' } },
      makeEnv()
    );

    // Tanpa sesi, 401 lebih dulu; flag tidak boleh membuka akses tanpa login.
    expect(response.status).toBe(401);
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const response = await app.request('/api/tidak-ada', {}, makeEnv());
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('not_found');
  });
});
