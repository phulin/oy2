-- Migration: Add notification records and delivery attempts
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_user_id INTEGER NOT NULL,
  from_user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  success INTEGER NOT NULL,
  status_code INTEGER,
  error_message TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_to_user
  ON notifications(to_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notification
  ON notification_deliveries(notification_id, created_at DESC);
