-- Add index for admin stats queries on user_last_seen
CREATE INDEX IF NOT EXISTS idx_user_last_seen_last_seen
  ON user_last_seen(last_seen DESC, user_id);
