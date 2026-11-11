-- Runtime bot: idempotency untuk batch XP/audit, indeks tambahan, dan mute.
CREATE TABLE IF NOT EXISTS bot_idempotency (
  key        TEXT PRIMARY KEY,
  bot_id     TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_idempotency_bot ON bot_idempotency(bot_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_group_created ON audit_log(group_jid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_bot_created ON events(bot_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mutes (
  group_jid  TEXT NOT NULL REFERENCES groups(jid) ON DELETE CASCADE,
  user_jid   TEXT NOT NULL,
  until_at   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_jid, user_jid)
);
CREATE INDEX IF NOT EXISTS idx_mutes_until ON mutes(until_at);