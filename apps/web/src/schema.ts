import type { D1Database } from '@cloudflare/workers-types';
import initSchema from '../../../migrations/0001_init.sql';
import rateLimitSchema from '../../../migrations/0002_auth_rate_limits.sql';
import sessionVersionSchema from '../../../migrations/0003_session_version.sql';
import botRuntimeSchema from '../../../migrations/0004_bot_runtime.sql';
import interactiveSchema from '../../../migrations/0005_interactive.sql';

// Versi skema yang diharapkan kode ini. Naikkan setiap kali migrasi baru ditambahkan.
export const SCHEMA_VERSION = 5;

const LOCK_NAME = 'schema_bootstrap';
const LOCK_TTL_MS = 60 * 1000;

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, name: '0001_init', sql: initSchema },
  { version: 2, name: '0002_auth_rate_limits', sql: rateLimitSchema },
  { version: 3, name: '0003_session_version', sql: sessionVersionSchema },
  { version: 4, name: '0004_bot_runtime', sql: botRuntimeSchema },
  { version: 5, name: '0005_interactive', sql: interactiveSchema }
];

/**
 * Memecah berkas SQL menjadi statement utuh.
 * Titik koma di dalam string, identifier, atau komentar tidak memotong statement.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === char && sql[j + 1] === char) {
          j += 2;
          continue;
        }
        if (sql[j] === char) break;
        j += 1;
      }
      current += sql.slice(i, Math.min(j + 1, sql.length));
      i = Math.min(j + 1, sql.length);
      continue;
    }

    if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      i += 1;
      continue;
    }

    current += char;
    i += 1;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function currentVersion(db: D1Database): Promise<number> {
  try {
    const row = await db
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .first<{ version: number | null }>();
    return row?.version ?? 0;
  } catch {
    // Tabel pelacak belum ada: database masih kosong.
    return 0;
  }
}

export interface BootstrapResult {
  from: number;
  to: number;
  applied: string[];
}

/**
 * Menerapkan migrasi yang belum pernah jalan, di dalam satu transaksi.
 * Aman dipanggil berulang dan aman dipanggil bersamaan.
 */
export async function applyMigrations(db: D1Database): Promise<BootstrapResult> {
  const from = await currentVersion(db);
  const pending = MIGRATIONS.filter((migration) => migration.version > from).sort(
    (a, b) => a.version - b.version
  );

  if (pending.length === 0) return { from, to: from, applied: [] };

  const statements = [
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)'
  ];
  for (const migration of pending) {
    for (const statement of splitStatements(migration.sql)) statements.push(statement);
    statements.push(
      `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (${migration.version}, '${migration.name}', ${Date.now()})`
    );
  }

  // Satu transaksi: sukses semua, atau tidak ada perubahan sama sekali.
  await db.batch(
    statements.map((statement) => db.prepare(statement))
  );

  return { from, to: Math.max(...pending.map((migration) => migration.version)), applied: pending.map((m) => m.name) };
}

/**
 * Menjalankan bootstrap dengan kunci di D1, sehingga dua permintaan
 * yang masuk bersamaan tidak menjalankan migrasi yang sama dua kali.
 */
export async function ensureSchema(db: D1Database): Promise<BootstrapResult> {
  const from = await currentVersion(db);
  if (from >= SCHEMA_VERSION) return { from, to: from, applied: [] };

  // Database kosong: tabel kunci belum ada. Satu batch transaksional sudah aman
  // karena setiap statement memakai IF NOT EXISTS dan INSERT OR IGNORE.
  if (from === 0) return applyMigrations(db);

  const now = Date.now();
  const claimed = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count, expires_at)
       VALUES (?1, ?2, 1, ?3)
       ON CONFLICT(key) DO UPDATE SET
         count = rate_limits.count + 1,
         window_start = ?2,
         expires_at = ?3
       WHERE rate_limits.expires_at <= ?2
       RETURNING key`
    )
    .bind(LOCK_NAME, now, now + LOCK_TTL_MS)
    .first<{ key: string }>();

  if (!claimed) return { from, to: from, applied: [] };

  return applyMigrations(db);
}
