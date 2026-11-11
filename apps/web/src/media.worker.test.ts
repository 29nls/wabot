import { describe, expect, it } from 'vitest';
import type { D1Database, Fetcher, R2Bucket } from '@cloudflare/workers-types';
import { signSession } from './auth';
import { app, type Env } from './worker';

const SECRET = 'secret-yang-cukup-panjang';
const CSRF = 'csrf-token-uji';
const ORIGIN = { Origin: 'http://localhost' };

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const MEDIA_ROW = {
  id: 'med_uji',
  kind: 'icon',
  mime: 'image/png',
  size_bytes: 128,
  created_at: 1794300000000
};

function fakeDb(row: typeof MEDIA_ROW | null = MEDIA_ROW) {
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
          if (sql.includes('FROM media_files WHERE id')) return row as never;
          return null as never;
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

function fakeR2(): { bucket: R2Bucket; puts: Array<{ key: string; bytes: Uint8Array; contentType?: string }> } {
  const puts: Array<{ key: string; bytes: Uint8Array; contentType?: string }> = [];
  const bucket = {
    async put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) {
      puts.push({ key, bytes: value, contentType: options?.httpMetadata?.contentType });
      return { key };
    },
    async get() {
      return null;
    },
    async head() {
      return null;
    }
  } as unknown as R2Bucket;
  return { bucket, puts };
}

function makeEnv(db: D1Database, bucket?: R2Bucket): Env {
  return {
    DB: db,
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    DASHBOARD_PASSWORD_HASH: 'pbkdf2$100000$c2FsdA$aGFzaA',
    SESSION_SECRET: SECRET,
    FILES: bucket
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

function formWithBytes(bytes: Uint8Array, type = 'image/png', kind = 'icon'): FormData {
  const form = new FormData();
  form.set('file', new File([bytes], 'unggahan.png', { type }));
  form.set('kind', kind);
  return form;
}

function pngBytes(size = 128): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(PNG_HEADER);
  return bytes;
}

function uploadHeaders(cookie: string): Record<string, string> {
  return { ...ORIGIN, 'X-CSRF-Token': CSRF, Cookie: cookie };
}

describe('upload media R2', () => {
  it('menyimpan PNG valid ke R2 dan mencatat media_files', async () => {
    const fake = fakeDb();
    const r2 = fakeR2();
    const response = await app.request(
      '/api/media',
      {
        method: 'POST',
        headers: uploadHeaders(await sessionCookie()),
        body: formWithBytes(pngBytes())
      },
      makeEnv(fake.db, r2.bucket)
    );
    const body = (await response.json()) as {
      data: { id: string; kind: string; mime: string; size_bytes: number };
    };

    expect(response.status).toBe(201);
    expect(body.data.mime).toBe('image/png');
    expect(body.data.kind).toBe('icon');
    expect(body.data.id).toMatch(/^med_/);
    expect(r2.puts).toHaveLength(1);
    expect(r2.puts[0].key).toMatch(/^media\/[A-Za-z0-9_-]+\.png$/);
    expect(r2.puts[0].contentType).toBe('image/png');

    const insert = fake.calls.find((call) => call.sql.includes('INSERT INTO media_files'));
    expect(insert).toBeDefined();
    expect(insert?.params).toContain('image/png');
  });

  it('menolak berkas lebih dari 2 MB dengan 413 tanpa menulis ke R2', async () => {
    const r2 = fakeR2();
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG_HEADER);

    const response = await app.request(
      '/api/media',
      {
        method: 'POST',
        headers: uploadHeaders(await sessionCookie()),
        body: formWithBytes(big)
      },
      makeEnv(fakeDb().db, r2.bucket)
    );

    expect(response.status).toBe(413);
    expect(r2.puts).toHaveLength(0);
  });

  it('menolak tipe di luar PNG/JPEG/WebP dengan 415', async () => {
    const r2 = fakeR2();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    const response = await app.request(
      '/api/media',
      {
        method: 'POST',
        headers: uploadHeaders(await sessionCookie()),
        body: formWithBytes(svg, 'image/svg+xml')
      },
      makeEnv(fakeDb().db, r2.bucket)
    );

    expect(response.status).toBe(415);
    expect(r2.puts).toHaveLength(0);
  });

  it('menolak magic bytes yang tidak cocok walaupun Content-Type PNG', async () => {
    const r2 = fakeR2();
    const gif = new TextEncoder().encode('GIF89a-bukan-png');

    const response = await app.request(
      '/api/media',
      {
        method: 'POST',
        headers: uploadHeaders(await sessionCookie()),
        body: formWithBytes(gif, 'image/png')
      },
      makeEnv(fakeDb().db, r2.bucket)
    );

    expect(response.status).toBe(415);
    expect(r2.puts).toHaveLength(0);
  });

  it('mengembalikan metadata media dan 404 untuk ID tak dikenal', async () => {
    const env = makeEnv(fakeDb().db, fakeR2().bucket);
    const cookie = await sessionCookie();

    const found = await app.request('/api/media/med_uji', { headers: { Cookie: cookie } }, env);
    expect(found.status).toBe(200);
    const body = (await found.json()) as { data: { id: string; mime: string } };
    expect(body.data.id).toBe('med_uji');
    expect(body.data.mime).toBe('image/png');

    const missing = await app.request(
      '/api/media/tidak_ada',
      { headers: { Cookie: cookie } },
      makeEnv(fakeDb(null).db, fakeR2().bucket)
    );
    expect(missing.status).toBe(404);
  });

  it('menolak upload tanpa sesi dan tanpa CSRF', async () => {
    const r2 = fakeR2();
    const noSession = await app.request(
      '/api/media',
      { method: 'POST', headers: { ...ORIGIN, 'X-CSRF-Token': CSRF }, body: formWithBytes(pngBytes()) },
      makeEnv(fakeDb().db, r2.bucket)
    );
    expect(noSession.status).toBe(401);

    const noCsrf = await app.request(
      '/api/media',
      {
        method: 'POST',
        headers: { ...ORIGIN, Cookie: await sessionCookie() },
        body: formWithBytes(pngBytes())
      },
      makeEnv(fakeDb().db, r2.bucket)
    );
    expect(noCsrf.status).toBe(403);
    expect(r2.puts).toHaveLength(0);
  });
});
