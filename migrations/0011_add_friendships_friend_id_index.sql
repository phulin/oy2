-- Migration: Add index for friendship mutual lookups
CREATE INDEX IF NOT EXISTS idx_friendships_friend_id
  ON friendships(friend_id);
