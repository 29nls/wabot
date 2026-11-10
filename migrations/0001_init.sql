PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bots (
  id            TEXT PRIMARY KEY,
  phone_jid     TEXT UNIQUE,
  display_name  TEXT,
  status        TEXT NOT NULL DEFAULT 'unpaired'
                CHECK (status IN ('unpaired','pairing','connected','disconnected','logged_out','error')),
  last_seen_at  INTEGER,
  paired_at     INTEGER,
  session_key   TEXT,
  app_version   TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pair_requests (
  id            TEXT PRIMARY KEY,
  bot_id        TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  phone_number  TEXT NOT NULL,
  code          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','dispatched','code_ready','connected','expired','failed','cancelled')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  error_code    TEXT,
  created_at    INTEGER NOT NULL,
  code_ready_at INTEGER,
  expires_at    INTEGER,
  completed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pair_status ON pair_requests(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pair_open ON pair_requests(bot_id)
  WHERE status IN ('pending','dispatched','code_ready');

CREATE TABLE IF NOT EXISTS groups (
  jid            TEXT PRIMARY KEY,
  bot_id         TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  owner_jid      TEXT,
  member_count   INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1,
  joined_at      INTEGER NOT NULL,
  last_synced_at INTEGER,
  last_active_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_groups_active ON groups(is_active, last_active_at DESC);

CREATE TABLE IF NOT EXISTS group_settings (
  group_jid         TEXT PRIMARY KEY REFERENCES groups(jid) ON DELETE CASCADE,
  prefix            TEXT NOT NULL DEFAULT '.',
  locale            TEXT NOT NULL DEFAULT 'id',
  welcome_enabled   INTEGER NOT NULL DEFAULT 1,
  welcome_template  TEXT NOT NULL DEFAULT 'Halo {mention}, selamat datang di *{group}*! 👋',
  goodbye_enabled   INTEGER NOT NULL DEFAULT 0,
  goodbye_template  TEXT NOT NULL DEFAULT '{name} keluar dari grup.',
  anti_link_mode    TEXT NOT NULL DEFAULT 'delete'
                    CHECK (anti_link_mode IN ('off','delete','kick')),
  link_allowlist    TEXT NOT NULL DEFAULT '[]',
  anti_spam_enabled INTEGER NOT NULL DEFAULT 1,
  spam_max_msgs     INTEGER NOT NULL DEFAULT 8,
  spam_window_sec   INTEGER NOT NULL DEFAULT 10,
  spam_action       TEXT NOT NULL DEFAULT 'warn'
                    CHECK (spam_action IN ('warn','delete','mute')),
  xp_enabled        INTEGER NOT NULL DEFAULT 1,
  xp_per_message    INTEGER NOT NULL DEFAULT 5,
  level_up_announce INTEGER NOT NULL DEFAULT 1,
  message_log       INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  group_jid      TEXT NOT NULL REFERENCES groups(jid) ON DELETE CASCADE,
  user_jid       TEXT NOT NULL,
  push_name      TEXT,
  xp             INTEGER NOT NULL DEFAULT 0,
  level          INTEGER NOT NULL DEFAULT 1,
  message_count  INTEGER NOT NULL DEFAULT 0,
  violations     INTEGER NOT NULL DEFAULT 0,
  joined_at      INTEGER,
  last_active_at INTEGER,
  PRIMARY KEY (group_jid, user_jid)
);
CREATE INDEX IF NOT EXISTS idx_members_xp ON members(group_jid, xp DESC);

CREATE TABLE IF NOT EXISTS commands (
  id          TEXT PRIMARY KEY,
  group_jid   TEXT REFERENCES groups(jid) ON DELETE CASCADE,
  trigger     TEXT NOT NULL,
  response    TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmd_unique ON commands(group_jid, trigger);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  group_jid   TEXT,
  actor_jid   TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_jid  TEXT,
  detail      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_group ON audit_log(group_jid, created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  bot_id     TEXT NOT NULL,
  level      TEXT NOT NULL CHECK (level IN ('debug','info','warn','error')),
  scope      TEXT NOT NULL,
  message    TEXT NOT NULL,
  meta       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at DESC);

CREATE TABLE IF NOT EXISTS media_files (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL CHECK (kind IN ('sticker','icon','audio','other')),
  mime        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  group_jid   TEXT,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_stats (
  stat_date      TEXT NOT NULL,
  bot_id         TEXT NOT NULL,
  messages_in    INTEGER NOT NULL DEFAULT 0,
  commands_used  INTEGER NOT NULL DEFAULT 0,
  active_groups  INTEGER NOT NULL DEFAULT 0,
  active_members INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (stat_date, bot_id)
);

INSERT OR IGNORE INTO bots (id, status, created_at, updated_at)
VALUES (
  'bot_1',
  'unpaired',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
);
