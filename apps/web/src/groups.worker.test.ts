import { describe, expect, it } from 'vitest';
import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import { signSession } from './auth';
import { app, type Env } from './worker';

const SECRET = 'secret-yang-cukup-panjang';
const CSRF = 'csrf-token-uji';
const ORIGIN = { Origin: 'http://localhost' };
const JID = '120363012345678901@g.us';

const GROUP = {
  jid: JID,
  name: 'Keluarga Wabot',
  owner_jid: '628111222333@s.whatsapp.net',
  member_count: 12,
  is_active: 1,
  joined_at: 1794000000000,
  last_active_at: 1794300000000
};

const SETTINGS = {
  prefix: '.',
  locale: 'id',
  welcome_enabled: 1,
  welcome_template: 'Halo {mention}',
  goodbye_enabled: 0,
  goodbye_template: '{name} keluar',
  anti_link_mode: 'delete',
  link_allowlist: '[]',
  anti_spam_enabled: 1,
  spam_max_msgs: 8,
  spam_window_sec: 10,
  spam_action: 'warn',
  xp_enabled: 1,
  xp_per_message: 5,
  level_up_announce: 1,
  message_log: 0
};

function fakeDb(options: { group?: typeof GROUP | null; settings?: typeof SETTINGS | null } = {}) {
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
          if (sql.includes('SELECT session_version FROM bots')) return { session_version: 0 } as never;
          if (sql.includes('SELECT jid, name, owner_jid')) return (options.group ?? null) as never;
          if (sql.includes('SELECT jid FROM groups')) return (options.group ? { jid: JID } : null) as never;
          if (sql.includes('FROM group_settings')) return (options.settings ?? null) as never;
          return null as never;
        },
        async run() {
          return { success: true } as never;
        },
        async all() {
          return { results: options.group ? [options.group] : [] } as never;
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
    SESSION_SECRET: SECRET
  };
}

async function sessionCookie(): Promise<string> {
  const now = Date.now();
  const token = await signSession(
    { sub: 'owner', iat: now, exp: now + 60_000, csrf: CSRF, session_version: 0 },
    SECRET
  );
  return `wabot_session=${token}`;
}

function headers(cookie: string): Record<string, string> {
  return { ...ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF, Cookie: cookie };
}

describe('API grup', () => {
  it('mengembalikan daftar grup ter-scope dengan JID ter-mask dan filter', async () => {
    const fake = fakeDb({ group: GROUP });
    const response = await app.request(
      '/api/groups?q=keluarga&active=1',
      { headers: { Cookie: await sessionCookie() } },
      makeEnv(fake.db)
    );
    const body = (await response.json()) as {
      data: { groups: Array<{ jid: string; jid_masked: string; name: string }> };
    };

    expect(response.status).toBe(200);
    expect(body.data.groups).toHaveLength(1);
    expect(body.data.groups[0].jid).toBe(JID);
    expect(body.data.groups[0].jid_masked).toBe('12036••••901@g.us');
    expect(body.data.groups[0].name).toBe('Keluarga Wabot');

    const listQuery = fake.calls.find((call) => call.sql.includes('FROM groups') && call.sql.includes('bot_id = ?1'));
    expect(listQuery?.params[0]).toBe('bot_1');
    expect(listQuery?.params[1]).toBe('keluarga');
    expect(listQuery?.params[3]).toBe(1);
  });

  it('mengembalikan 404 untuk grup yang tidak dikenal', async () => {
    const response = await app.request(
      '/api/groups/120363000000000000@g.us',
      { headers: { Cookie: await sessionCookie() } },
      makeEnv(fakeDb({ group: null }).db)
    );

    expect(response.status).toBe(404);
  });

  it('mengembalikan detail grup beserta settings', async () => {
    const response = await app.request(
      `/api/groups/${encodeURIComponent(JID)}`,
      { headers: { Cookie: await sessionCookie() } },
      makeEnv(fakeDb({ group: GROUP, settings: SETTINGS }).db)
    );
    const body = (await response.json()) as {
      data: { group: { jid_masked: string; owner_jid_masked: string | null }; settings: { prefix: string } };
    };

    expect(response.status).toBe(200);
    expect(body.data.group.jid_masked).toBe('12036••••901@g.us');
    expect(body.data.group.owner_jid_masked).toBe('62811••••333@s.whatsapp.net');
    expect(body.data.settings.prefix).toBe('.');
  });

  it('menolak field asing pada PATCH settings dengan 400', async () => {
    const response = await app.request(
      `/api/groups/${encodeURIComponent(JID)}/settings`,
      {
        method: 'PATCH',
        headers: headers(await sessionCookie()),
        body: JSON.stringify({ prefix: '!', danger: true })
      },
      makeEnv(fakeDb({ group: GROUP, settings: SETTINGS }).db)
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_settings');
  });

  it('menolak PATCH tanpa CSRF', async () => {
    const response = await app.request(
      `/api/groups/${encodeURIComponent(JID)}/settings`,
      {
        method: 'PATCH',
        headers: { ...ORIGIN, 'Content-Type': 'application/json', Cookie: await sessionCookie() },
        body: JSON.stringify({ prefix: '!' })
      },
      makeEnv(fakeDb({ group: GROUP, settings: SETTINGS }).db)
    );

    expect(response.status).toBe(403);
  });

  it('menyimpan settings valid dan menulis audit_log', async () => {
    const fake = fakeDb({ group: GROUP, settings: SETTINGS });
    const response = await app.request(
      `/api/groups/${encodeURIComponent(JID)}/settings`,
      {
        method: 'PATCH',
        headers: headers(await sessionCookie()),
        body: JSON.stringify({ prefix: '!', welcome_enabled: false, link_allowlist: ['contoh.com'] })
      },
      makeEnv(fake.db)
    );

    expect(response.status).toBe(200);

    const update = fake.calls.find((call) => call.sql.startsWith('UPDATE group_settings'));
    expect(update).toBeDefined();
    expect(update?.sql).toContain('prefix = ?2');
    expect(update?.params[0]).toBe(JID);
    expect(update?.params).toContain('!');
    expect(update?.params).toContain(0);
    expect(update?.params).toContain(JSON.stringify(['contoh.com']));

    const audit = fake.calls.find((call) => call.sql.includes('INSERT INTO audit_log'));
    expect(audit).toBeDefined();
    expect(audit?.sql).toContain("'owner'");
    expect(audit?.sql).toContain("'settings.update'");
    expect(audit?.params[1]).toBe(JID);
  });
});
