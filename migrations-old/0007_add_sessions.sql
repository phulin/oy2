-- Migration: Add sessions table for multi-device logins
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions(user_id);

INSERT INTO sessions (token, user_id, created_at)
  SELECT session_token, id, strftime('%s', 'now')
  FROM users
  WHERE session_token IS NOT NULL;
