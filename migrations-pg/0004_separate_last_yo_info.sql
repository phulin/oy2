-- Separate last_yo info into its own table for async loading
CREATE TABLE IF NOT EXISTS last_yo_info (
  user_id INTEGER NOT NULL,
  friend_id INTEGER NOT NULL,
  last_yo_id INTEGER,
  last_yo_type TEXT,
  last_yo_created_at INTEGER,
  last_yo_from_user_id INTEGER,
  streak INTEGER DEFAULT 1 NOT NULL,
  streak_start_date INTEGER,
  PRIMARY KEY (user_id, friend_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_last_yo_info_user
  ON last_yo_info(user_id);

-- Migrate existing data from friendships table
INSERT INTO last_yo_info (user_id, friend_id, last_yo_id, last_yo_type, last_yo_created_at, last_yo_from_user_id, streak, streak_start_date)
SELECT user_id, friend_id, last_yo_id, last_yo_type, last_yo_created_at, last_yo_from_user_id, streak, streak_start_date
FROM friendships
WHERE last_yo_id IS NOT NULL
ON CONFLICT (user_id, friend_id) DO NOTHING;

-- Drop old columns from friendships table
ALTER TABLE friendships DROP COLUMN IF EXISTS last_yo_id;
ALTER TABLE friendships DROP COLUMN IF EXISTS last_yo_type;
ALTER TABLE friendships DROP COLUMN IF EXISTS last_yo_created_at;
ALTER TABLE friendships DROP COLUMN IF EXISTS last_yo_from_user_id;
ALTER TABLE friendships DROP COLUMN IF EXISTS streak;
ALTER TABLE friendships DROP COLUMN IF EXISTS streak_start_date;
