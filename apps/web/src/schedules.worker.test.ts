import { describe, expect, it } from 'vitest';
import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import { signSession } from './auth';
import { app, type Env } from './worker';

const SECRET = 'secret-yang-cukup-panjang';
const CSRF = 'csrf-token-uji';
const BOT_KEY = 'bot-key-uji-yang-panjang';
const ORIGIN = { Origin: 'http://localhost' };
const GROUP = '628111-123@g.us';
const FOREIGN_GROUP = '628999-999@g.us';
const OWN_ID = 'sm_own_1';
const FOREIGN_ID = 'sm_foreign_1';
const NOW = Date.now();

interface FakeCall {
  sql: string;
  params: unknown[];
}

function scheduleDb(): { db: D1Database; calls: FakeCall[] } {
  const calls: FakeCall[] = [];

  function first(sql: string, params: unknown[]): unknown {
    if (sql.includes('SELECT session_version FROM bots')) return { session_version: 0 };
    if (sql.includes('INSERT INTO rate_limits')) {
      return { count: 1, window_start: Number(params[1] ?? Date.now()), expires_at: Date.now() + 60_000 };
    }
    if (sql.includes('FROM groups WHERE jid = ?1 AND bot_id = ?2')) {
      return params[0] === GROUP && params[1] === 'bot_1' ? { jid: GROUP } : null;
    }
    if (sql.includes('SELECT id FROM scheduled_messages WHERE id = ?1 AND bot_id = ?2')) {
      return params[0] === OWN_ID && params[1] === 'bot_1' ? { id: OWN_ID } : null;
    }
    if (sql.includes('SELECT id, repeat_sec FROM scheduled_messages')) {
      return params[0] === OWN_ID && params[1] === 'bot_1' ? { id: OWN_ID, repeat_sec: 3600 } : null;
    }
    return null;
  }

  function all(sql: string, params: unknown[]): unknown[] {
    if (sql.includes('FROM scheduled_messages WHERE bot_id = ?1 AND group_jid = ?2')) {
      return params[0] === 'bot_1' && params[1] === GROUP
        ? [{ id: OWN_ID, group_jid: GROUP, message: 'halo', next_run_at: NOW, repeat_sec: 0, enabled: 1 }]
        : [];
    }
    if (sql.includes('FROM scheduled_messages s')) {
      return params[0] === 'bot_1'
        ? [{ id: OWN_ID, group_jid: GROUP, message: 'halo', repeat_sec: 0, next_run_at: NOW }]
        : [];
    }
    return [];
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
          return (first(sql, call.params) ?? null) as never;
        },
        async run() {
          return { success: true, meta: { changes: 1 } } as never;
        },
        async all() {
          return { results: all(sql, call.params) } as never;
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
    BOT_API_KEY: BOT_KEY,
    BOT_ID: 'bot_1'
  };
}

async function cookie(): Promise<string> {
  const now = Date.now();
  const token = await signSession(
    { sub: 'owner', iat: now, exp: now + 60_000, csrf: CSRF, session_version: 0 },
    SECRET
  );
  return `wabot_session=${token}`;
}

function headers(cookieValue: string): Record<string, string> {
  return { ...ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF, Cookie: cookieValue };
}

function botHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${BOT_KEY}`, 'Content-Type': 'application/json' };
}

function jsonRequest(path: string, init: RequestInit, db: D1Database): Promise<Response> | Response {
  return app.request(path, init, makeEnv(db));
}

describe('schedules CRUD', () => {
  it('GET mengembalikan jadwal milik grup sendiri', async () => {
    const response = await jsonRequest(
      `/api/groups/${encodeURIComponent(GROUP)}/schedules`,
      { headers: { Cookie: await cookie() } },
      scheduleDb().db
    );
    const body = (await response.json()) as { ok: boolean; data: unknown[] };
    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
  });

  it('GET grup bot lain 404', async () => {
    const response = await jsonRequest(
      `/api/groups/${encodeURIComponent(FOREIGN_GROUP)}/schedules`,
      { headers: { Cookie: await cookie() } },
      scheduleDb().db
    );
    expect(response.status).toBe(404);
  });

  it('POST membuat jadwal dengan scope bot', async () => {
    const fake = scheduleDb();
    const response = await jsonRequest(
      `/api/groups/${encodeURIComponent(GROUP)}/schedules`,
      {
        method: 'POST',
        headers: headers(await cookie()),
        body: JSON.stringify({ message: 'Halo', next_run_at: NOW + 60_000, repeat_sec: 3600 })
      },
      fake.db
    );
    expect(response.status).toBe(201);
    const insert = fake.calls.find((call) => call.sql.includes('INSERT INTO scheduled_messages'));
    expect(insert?.params[1]).toBe('bot_1');
    expect(insert?.params[2]).toBe(GROUP);
  });

  it('POST menolak repeat_sec di luar batas', async () => {
    const response = await jsonRequest(
      `/api/groups/${encodeURIComponent(GROUP)}/schedules`,
      {
        method: 'POST',
        headers: headers(await cookie()),
        body: JSON.stringify({ message: 'Halo', next_run_at: NOW, repeat_sec: 999_999_999 })
      },
      scheduleDb().db
    );
    expect(response.status).toBe(400);
  });

  it('POST menolak field tak dikenal', async () => {
    const response = await jsonRequest(
      `/api/groups/${encodeURIComponent(GROUP)}/schedules`,
      {
        method: 'POST',
        headers: headers(await cookie()),
        body: JSON.stringify({ message: 'Halo', next_run_at: NOW, bot_id: 'bot_other' })
      },
      scheduleDb().db
    );
    expect(response.status).toBe(400);
  });

  it('PATCH hanya menerima field whitelist', async () => {
    const response = await jsonRequest(
      `/api/schedules/${OWN_ID}`,
      {
        method: 'PATCH',
        headers: headers(await cookie()),
        body: JSON.stringify({ message: 'Baru', bot_id: 'bot_other' })
      },
      scheduleDb().db
    );
    expect(response.status).toBe(400);
  });

  it('PATCH memperbarui jadwal sendiri', async () => {
    const fake = scheduleDb();
    const response = await jsonRequest(
      `/api/schedules/${OWN_ID}`,
      {
        method: 'PATCH',
        headers: headers(await cookie()),
        body: JSON.stringify({ enabled: false, message: 'Baru' })
      },
      fake.db
    );
    expect(response.status).toBe(200);
    expect(fake.calls.some((call) => call.sql.includes('UPDATE scheduled_messages SET'))).toBe(true);
  });

  it('PATCH jadwal bot lain 404', async () => {
    const response = await jsonRequest(
      `/api/schedules/${FOREIGN_ID}`,
      {
        method: 'PATCH',
        headers: headers(await cookie()),
        body: JSON.stringify({ message: 'Baru' })
      },
      scheduleDb().db
    );
    expect(response.status).toBe(404);
  });

  it('DELETE jadwal sendiri berhasil', async () => {
    const fake = scheduleDb();
    const response = await jsonRequest(
      `/api/schedules/${OWN_ID}`,
      { method: 'DELETE', headers: headers(await cookie()) },
      fake.db
    );
    expect(response.status).toBe(200);
    expect(fake.calls.some((call) => call.sql.includes('DELETE FROM scheduled_messages'))).toBe(true);
  });

  it('DELETE jadwal bot lain 404', async () => {
    const response = await jsonRequest(
      `/api/schedules/${FOREIGN_ID}`,
      { method: 'DELETE', headers: headers(await cookie()) },
      scheduleDb().db
    );
    expect(response.status).toBe(404);
  });
});

describe('schedules bot', () => {
  it('GET schedules tanpa Bearer 401 dan tidak menyentuh D1', async () => {
    const fake = scheduleDb();
    const response = await jsonRequest('/api/bot/schedules', {}, fake.db);
    expect(response.status).toBe(401);
    expect(fake.calls.some((call) => call.sql.includes('scheduled_messages'))).toBe(false);
  });

  it('POST maintenance tanpa Bearer 401 tanpa satu pun DELETE', async () => {
    const fake = scheduleDb();
    const response = await jsonRequest(
      '/api/bot/maintenance',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      fake.db
    );
    expect(response.status).toBe(401);
    expect(fake.calls.some((call) => call.sql.startsWith('DELETE'))).toBe(false);
  });

  it('GET hanya mengembalikan jadwal jatuh tempo milik bot', async () => {
    const fake = scheduleDb();
    const response = await jsonRequest('/api/bot/schedules', { headers: botHeaders() }, fake.db);
    const body = (await response.json()) as { data: { schedules: unknown[] } };
    expect(response.status).toBe(200);
    expect(body.data.schedules).toHaveLength(1);
    expect(fake.calls.find((call) => call.sql.includes('FROM scheduled_messages s'))?.params[0]).toBe(
      'bot_1'
    );
  });

  it('POST executed memajukan jadwal berulang', async () => {
    const fake = scheduleDb();
    const response = await jsonRequest(
      `/api/bot/schedules/${OWN_ID}/executed`,
      { method: 'POST', headers: botHeaders(), body: JSON.stringify({ ok: true }) },
      fake.db
    );
    const body = (await response.json()) as { data: { next_run_at: number; enabled: boolean } };
    expect(response.status).toBe(200);
    expect(body.data.enabled).toBe(true);
    expect(body.data.next_run_at).toBeGreaterThan(NOW);
  });

  it('POST executed jadwal bot lain 404', async () => {
    const response = await jsonRequest(
      `/api/bot/schedules/${FOREIGN_ID}/executed`,
      { method: 'POST', headers: botHeaders(), body: JSON.stringify({ ok: true }) },
      scheduleDb().db
    );
    expect(response.status).toBe(404);
  });

  it('POST maintenance membersihkan semua tabel retensi', async () => {
    const fake = scheduleDb();
    const response = await jsonRequest(
      '/api/bot/maintenance',
      { method: 'POST', headers: botHeaders(), body: JSON.stringify({}) },
      fake.db
    );
    const body = (await response.json()) as { data: Record<string, number> };
    expect(response.status).toBe(200);
    expect(body.data.events).toBe(1);
    expect(fake.calls.some((call) => call.sql.includes('DELETE FROM audit_log'))).toBe(true);
    expect(fake.calls.some((call) => call.sql.includes('DELETE FROM daily_stats'))).toBe(true);
    expect(fake.calls.some((call) => call.sql.includes('DELETE FROM mutes'))).toBe(true);
  });
});

describe('hardening', () => {
  it('menolak body non-JSON dengan 415', async () => {
    const response = await app.request(
      '/api/bot/maintenance',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${BOT_KEY}`, 'Content-Type': 'text/plain' },
        body: 'halo'
      },
      makeEnv(scheduleDb().db)
    );
    expect(response.status).toBe(415);
  });

  it('menambah HSTS pada permintaan https', async () => {
    const response = await app.request('https://wabot.example/api/health', {}, makeEnv(scheduleDb().db));
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
  });

  it('tidak menambah HSTS pada http lokal', async () => {
    const response = await app.request('http://localhost/api/health', {}, makeEnv(scheduleDb().db));
    expect(response.headers.get('Strict-Transport-Security')).toBeNull();
  });

  it('menolak bot_id body yang bukan milik kunci', async () => {
    const response = await jsonRequest(
      '/api/bot/events',
      {
        method: 'POST',
        headers: botHeaders(),
        body: JSON.stringify({ bot_id: 'bot_other', entries: [] })
      },
      scheduleDb().db
    );
    expect(response.status).toBe(403);
  });

  it('mencatat penolakan Bearer dengan key termask', async () => {
    const fake = scheduleDb();
    const response = await app.request(
      '/api/bot/heartbeat',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer rahasia-panjang-sekali', 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      },
      makeEnv(fake.db)
    );
    expect(response.status).toBe(401);
    const log = fake.calls.find((call) => call.sql.includes('INSERT INTO events'));
    expect(log?.params[3]).not.toContain('rahasia-panjang-sekali');
    expect(String(log?.params[3])).toContain('raha***');
  });

  it('menolak mutasi dashboard tanpa CSRF', async () => {
    const response = await jsonRequest(
      `/api/schedules/${OWN_ID}`,
      {
        method: 'DELETE',
        headers: { ...ORIGIN, Cookie: await cookie() }
      },
      scheduleDb().db
    );
    expect(response.status).toBe(403);
  });

  it('401 seragam tanpa membedakan cookie hilang dan cookie rusak', async () => {
    const db = scheduleDb().db;
    const missing = await jsonRequest('/api/session', {}, db);
    const broken = await jsonRequest('/api/session', { headers: { Cookie: 'wabot_session=rusak.sama' } }, db);

    expect(missing.status).toBe(401);
    expect(broken.status).toBe(401);
    expect(await missing.json()).toEqual(await broken.json());
  });

  it('API privat memakai Cache-Control no-store', async () => {
    const response = await jsonRequest(
      `/api/groups/${encodeURIComponent(GROUP)}/schedules`,
      { headers: { Cookie: await cookie() } },
      scheduleDb().db
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
