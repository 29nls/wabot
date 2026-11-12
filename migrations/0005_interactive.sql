-- M5: fitur P1 interaktif + retensi.
-- Idempoten: semua CREATE TABLE/INDEX memakai IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id          TEXT PRIMARY KEY,
  bot_id      TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  group_jid   TEXT NOT NULL REFERENCES groups(jid) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  next_run_at INTEGER NOT NULL,
  repeat_sec  INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  last_run_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_scheduled_due
  ON scheduled_messages (bot_id, enabled, next_run_at);
