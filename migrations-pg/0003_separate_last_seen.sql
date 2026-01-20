-- Move last_seen to its own table for better write performance

CREATE TABLE IF NOT EXISTS user_last_seen (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen INTEGER NOT NULL
);

-- Migrate existing data
INSERT INTO user_last_seen (user_id, last_seen)
SELECT id, last_seen FROM users WHERE last_seen IS NOT NULL;

-- Drop the old column and index
DROP INDEX IF EXISTS idx_users_last_seen;
ALTER TABLE users DROP COLUMN IF EXISTS last_seen;
