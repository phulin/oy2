-- Add moderation tables for blocking/reporting and profile counters.
CREATE TABLE user_blocks (
  blocker_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);

CREATE INDEX idx_user_blocks_blocked_user
  ON user_blocks(blocked_user_id);

CREATE TABLE user_reports (
  id SERIAL PRIMARY KEY,
  reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at INTEGER,
  resolution_note TEXT,
  CHECK (reporter_user_id <> target_user_id)
);

CREATE INDEX idx_user_reports_target_created
  ON user_reports(target_user_id, created_at DESC);

CREATE INDEX idx_user_reports_reporter_created
  ON user_reports(reporter_user_id, created_at DESC);

CREATE INDEX idx_user_reports_status_created
  ON user_reports(status, created_at DESC);
