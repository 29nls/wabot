import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { MIGRATIONS, SCHEMA_VERSION, splitStatements } from './schema';

describe('splitStatements', () => {
  it('memisahkan statement pada titik koma', () => {
    expect(splitStatements('CREATE TABLE a (id TEXT); CREATE TABLE b (id TEXT);')).toEqual([
      'CREATE TABLE a (id TEXT)',
      'CREATE TABLE b (id TEXT)'
    ]);
  });

  it('tidak memotong titik koma di dalam string', () => {
    const sql = "INSERT INTO t (v) VALUES ('a;b');";
    expect(splitStatements(sql)).toEqual(["INSERT INTO t (v) VALUES ('a;b')"]);
  });

  it('menangani kutip tunggal yang di-escape', () => {
    const sql = "INSERT INTO t (v) VALUES ('it''s; ok');";
    expect(splitStatements(sql)).toEqual(["INSERT INTO t (v) VALUES ('it''s; ok')"]);
  });

  it('mengabaikan titik koma di dalam komentar', () => {
    const sql = '-- komentar; dengan titik koma\nCREATE TABLE a (id TEXT);';
    expect(splitStatements(sql)).toHaveLength(1);
    expect(splitStatements(sql)[0]).toContain('CREATE TABLE a (id TEXT)');
  });

  it('membuang statement kosong', () => {
    expect(splitStatements(';;\n  \n;')).toEqual([]);
  });
});

describe('migrasi', () => {
  it('versi tertinggi sama dengan SCHEMA_VERSION', () => {
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(SCHEMA_VERSION);
  });

  it('setiap migrasi punya statement yang bisa dijalankan', () => {
    for (const migration of MIGRATIONS) {
      expect(splitStatements(migration.sql).length).toBeGreaterThan(0);
    }
  });

  it('semua statement DDL bersifat idempoten', () => {
    for (const migration of MIGRATIONS) {
      for (const statement of splitStatements(migration.sql)) {
        if (/^CREATE\s+(TABLE|INDEX|UNIQUE)/i.test(statement)) {
          expect(statement).toMatch(/IF NOT EXISTS/i);
        }
      }
    }
  });
});

describe('ensureSchema', () => {
  it('tidak menyentuh database jika skema sudah versi terbaru', async () => {
    let batched = 0;
    const db = {
      prepare: () => ({
        first: async () => ({ version: SCHEMA_VERSION })
      }),
      batch: async () => {
        batched += 1;
        return [];
      }
    } as unknown as D1Database;

    const { ensureSchema } = await import('./schema');
    const result = await ensureSchema(db);

    expect(result.applied).toEqual([]);
    expect(batched).toBe(0);
  });

  it('tidak menjalankan migrasi jika kunci sedang dipegang proses lain', async () => {
    let batched = 0;
    const db = {
      prepare: (sql: string) => {
        const first = async () => {
          if (sql.includes('MAX(version)')) return { version: 1 };
          return null; // kunci tidak berhasil diklaim
        };
        return { first, bind: () => ({ first }) };
      },
      batch: async () => {
        batched += 1;
        return [];
      }
    } as unknown as D1Database;

    const { ensureSchema } = await import('./schema');
    const result = await ensureSchema(db);

    expect(result.applied).toEqual([]);
    expect(result.from).toBe(1);
    expect(batched).toBe(0);
  });

  it('menerapkan semua migrasi pada database kosong dalam satu batch', async () => {
    const executed: string[] = [];
    const db = {
      prepare: (sql: string) => ({
        first: async () => {
          if (sql.includes('schema_migrations')) throw new Error('no such table');
          return null;
        }
      }),
      batch: async (statements: unknown[]) => {
        executed.push(...statements.map(() => 'statement'));
        return [];
      }
    } as unknown as D1Database;

    const { ensureSchema } = await import('./schema');
    const result = await ensureSchema(db);

    expect(result.from).toBe(0);
    expect(result.to).toBe(SCHEMA_VERSION);
    expect(result.applied).toHaveLength(MIGRATIONS.length);
    // Tabel pelacak + seluruh statement migrasi + satu baris versi per migrasi.
    expect(executed.length).toBeGreaterThan(MIGRATIONS.length);
  });
});
