-- Migration: Add admin flag and last seen timestamp to users
ALTER TABLE users ADD COLUMN admin INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN last_seen INTEGER;

UPDATE users SET last_seen = strftime('%s', 'now') WHERE last_seen IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_last_seen
  ON users(last_seen DESC);
