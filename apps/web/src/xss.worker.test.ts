import { describe, expect, it } from 'vitest';
import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import { signSession } from './auth';
import { app, type Env } from './worker';

/**
 * UI-07 — XSS tersimpan: nama grup masuk lewat `/api/bot/groups/sync`, template
 * dan push name lewat endpoint bot/dashboard. Yang diuji adalah sisi server:
 * nilai keluar apa adanya (tidak diubah jadi markup) dan content-type tetap
 * JSON, sehingga tidak ada HTML yang dieksekusi dari respons.
 *
 * Jaminan eksekusi ada di render — `apps/web/ui/src` memakai nilai sebagai
 * children React dan tidak memuat `dangerouslySetInnerHTML`/`innerHTML`.
 * Uji ini tidak mensimulasikan penyimpanan D1; ia memakai fake yang menjawab
 * query dengan payload.
 */

const SECRET = 'secret-yang-cukup-panjang';
const CSRF = 'csrf-token-uji';
const BOT_KEY = 'bot-key-uji-yang-panjang';
const GROUP = '628111-900@g.us';
const USER = '628999@s.whatsapp.net';

const PAYLOAD = '<img src=x onerror=alert(1)><script>alert(2)</script>';
const ATTRIBUTE_PAYLOAD = '"><img src=x onerror=alert(1)>';

interface FakeCall {
  sql: string;
  params: unknown[];
}

const DEFAULT_SETTINGS: Record<string, unknown> = {
  prefix: '.',
  locale: 'id',
  welcome_enabled: 1,
  welcome_template: 'Halo {mention}, selamat datang di *{group}*!',
  goodbye_enabled: 0,
  goodbye_template: '{name} keluar dari grup.',
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

/**
 * D1 palsu minimal: tiap statement menjawab satu baris konsisten. Cukup untuk
 * middleware (rate limit, idempotency) dan untuk membuktikan worker
 * tidak mengubah payload jadi markup. Tidak mensimulasikan penyimpanan.
 */
function storedDb() {
  const calls: FakeCall[] = [];
  // Grup dianggap ada (scoping lolos) supaya jalur render data benar-benar diuji.
  const hasGroup = true;

  const statement = {
    bind(...params: unknown[]) {
      const last = calls[calls.length - 1];
      if (last) last.params = params;
      return statement;
    },
    async first() {
      const sql = calls[calls.length - 1]?.sql ?? '';
      if (sql.includes('INSERT INTO rate_limits')) {
        const now = Date.now();
        return { count: 1, window_start: now, expires_at: now + 60_000 } as never;
      }
      if (sql.includes('session_version FROM bots') || sql.includes('FROM bots')) {
        return { session_version: 0 } as never;
      }
      if (hasGroup && sql.includes('FROM groups')) {
        // Detail grup memakai SELECT jid, name, ... WHERE jid = ?1 AND bot_id = ?2.
        if (sql.includes('name')) return { jid: GROUP, name: PAYLOAD } as never;
        return { jid: GROUP } as never;
      }
      if (hasGroup && sql.includes('group_settings')) {
        return { welcome_template: ATTRIBUTE_PAYLOAD, goodbye_template: PAYLOAD } as never;
      }
      return null as never;
    },
    async run() {
      return { success: true, meta: { changes: 1 }, changes: 1 } as never;
    },
    async all() {
      const sql = calls[calls.length - 1]?.sql ?? '';
      if (hasGroup && sql.includes('FROM groups')) {
        return { results: [{ jid: GROUP, name: PAYLOAD, member_count: 3, is_active: 1 }] } as never;
      }
      if (hasGroup && sql.includes('FROM members')) {
        return {
          results: [
            {
              user_jid: USER,
              push_name: PAYLOAD,
              xp: 25,
              level: 1,
              message_count: 1,
              violations: 0,
              last_active_at: Date.now()
            }
          ]
        } as never;
      }
      return { results: [] } as never;
    }
  };

  const db = {
    prepare(sql: string) {
      calls.push({ sql, params: [] });
      return statement;
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return Promise.all(statements.map((item) => item.run()));
    }
  } as unknown as D1Database;

  return { db, calls };
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    BOT_ID: 'bot_1',
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    DASHBOARD_PASSWORD_HASH: 'pbkdf2$100000$c2FsdA$aGFzaA',
    SESSION_SECRET: SECRET,
    BOT_API_KEY: BOT_KEY
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

function botHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${BOT_KEY}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': 'xss-uji-1'
  };
}

async function dashboardHeaders(): Promise<Record<string, string>> {
  return {
    Origin: 'http://localhost',
    'Content-Type': 'application/json',
    'X-CSRF-Token': CSRF,
    Cookie: await cookie()
  };
}

describe('XSS tersimpan UI-07', () => {
  /**
   * Satu assertion per titik masuk cukup: yang diperiksa bukan isi database
   * palsu, tetapi apakah respons server mengubah payload jadi markup atau
   * mengubah content-type. Nilai harus keluar utuh dan tetap JSON.
   */
  function expectPlainJson(response: Response, body: string): void {
    const type = response.headers.get('content-type') ?? '';
    expect(type).toContain('application/json');
    expect(type).not.toContain('text/html');
    expect(body).not.toContain('<script>alert(2)</script><');
    expect(body).toContain('<script>alert(2)</script>');
  }

  it('nama grup dari bot keluar apa adanya di daftar, detail, dan config bot', async () => {
    const fake = storedDb();
    const env = makeEnv(fake.db);

    const sync = await app.request(
      '/api/bot/groups/sync',
      {
        method: 'POST',
        headers: botHeaders(),
        body: JSON.stringify({ groups: [{ jid: GROUP, name: PAYLOAD }], complete: true })
      },
      env
    );
    expect(sync.status).toBe(200);
    // Endpoint tulis hanya mengembalikan jumlah, bukan echo nama grup.
    const syncText = await sync.text();
    expect(syncText).not.toContain(PAYLOAD);
    expect(fake.calls.some((call) => call.sql.includes('INSERT INTO groups'))).toBe(true);

    const detail = await app.request(
      `/api/groups/${encodeURIComponent(GROUP)}`,
      { headers: { Cookie: await cookie() } },
      env
    );
    const detailText = await detail.text();
    expect(detail.status).toBe(200);
    expectPlainJson(detail, detailText);
    expect((JSON.parse(detailText) as { data: { group: { name: string } } }).data.group.name).toBe(PAYLOAD);

    const config = await app.request('/api/bot/config', { headers: botHeaders() }, env);
    const configText = await config.text();
    expect(config.status).toBe(200);
    expectPlainJson(config, configText);
    expect((JSON.parse(configText) as { data: { groups: Array<{ name: string }> } }).data.groups[0].name).toBe(
      PAYLOAD
    );

    const list = await app.request('/api/groups', { headers: { Cookie: await cookie() } }, env);
    const listText = await list.text();
    expect(list.status).toBe(200);
    expectPlainJson(list, listText);
    expect((JSON.parse(listText) as { data: { groups: Array<{ name: string }> } }).data.groups[0].name).toBe(
      PAYLOAD
    );
  });

  it('template selamat datang/pamit lewat PATCH settings tersimpan mentah', async () => {
    const fake = storedDb();
    const env = makeEnv(fake.db);

    const patch = await app.request(
      `/api/groups/${encodeURIComponent(GROUP)}/settings`,
      {
        method: 'PATCH',
        headers: await dashboardHeaders(),
        body: JSON.stringify({ welcome_template: ATTRIBUTE_PAYLOAD, goodbye_template: PAYLOAD })
      },
      env
    );
    const text = await patch.text();
    expect(patch.status).toBe(200);
    expectPlainJson(patch, text);
    const body = (JSON.parse(text) as { data: { settings: { welcome_template: string; goodbye_template: string } } })
      .data.settings;
    expect(body.welcome_template).toBe(ATTRIBUTE_PAYLOAD);
    expect(body.goodbye_template).toBe(PAYLOAD);
  });

  it('push name anggota lewat batch XP tetap teks', async () => {
    const fake = storedDb();
    const env = makeEnv(fake.db);

    const xp = await app.request(
      '/api/bot/members/xp',
      {
        method: 'POST',
        headers: botHeaders(),
        body: JSON.stringify({ updates: [{ group_jid: GROUP, user_jid: USER, push_name: PAYLOAD, delta: 25 }] })
      },
      env
    );
    expect(xp.status).toBe(200);
    expect(JSON.parse(await xp.clone().text())).toMatchObject({ ok: true });

    // Endpoint baca mengembalikan push_name apa adanya; klien melihat teks.
    const members = await app.request(
      `/api/groups/${encodeURIComponent(GROUP)}/members`,
      { headers: { Cookie: await cookie() } },
      env
    );
    const membersText = await members.text();
    expect(members.status).toBe(200);
    expectPlainJson(members, membersText);
    expect(
      (JSON.parse(membersText) as { data: { members: Array<{ push_name: string | null }> } }).data.members[0]
        ?.push_name
    ).toBe(PAYLOAD);
  });
});
