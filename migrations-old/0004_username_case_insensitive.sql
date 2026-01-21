-- Migration: Enforce case-insensitive usernames
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase
  ON users(username COLLATE NOCASE);
