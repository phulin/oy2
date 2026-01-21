-- Production schema snapshot for PostgreSQL (generated from migrations-pg).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  phone TEXT,
  phone_verified INTEGER DEFAULT 0,
  admin INTEGER DEFAULT 0,
  oauth_provider TEXT,
  oauth_sub TEXT,
  email TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
  ON users (LOWER(username));

CREATE INDEX IF NOT EXISTS idx_users_username_trgm
  ON users USING GIN (username gin_trgm_ops);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth
  ON users(oauth_provider, oauth_sub)
  WHERE oauth_provider IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_last_seen (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_last_seen_last_seen
  ON user_last_seen(last_seen DESC, user_id);

CREATE TABLE IF NOT EXISTS friendships (
  user_id INTEGER NOT NULL,
  friend_id INTEGER NOT NULL,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  PRIMARY KEY (user_id, friend_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_friendships_user
  ON friendships(user_id);

CREATE INDEX IF NOT EXISTS idx_friendships_friend_id
  ON friendships(friend_id);

CREATE TABLE IF NOT EXISTS last_oy_info (
  user_id INTEGER NOT NULL,
  friend_id INTEGER NOT NULL,
  last_oy_id INTEGER,
  last_oy_type TEXT,
  last_oy_created_at INTEGER,
  last_oy_from_user_id INTEGER,
  streak_start_date INTEGER,
  PRIMARY KEY (user_id, friend_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_last_oy_info_user
  ON last_oy_info(user_id);

CREATE TABLE IF NOT EXISTS oys (
  id SERIAL PRIMARY KEY,
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER NOT NULL,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  type TEXT DEFAULT 'oy',
  payload TEXT,
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oys_to_user
  ON oys(to_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oys_to_user_created_at_id
  ON oys(to_user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_oys_from_user_created_at_id
  ON oys(from_user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  PRIMARY KEY (user_id, endpoint),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
  ON push_subscriptions(endpoint);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  to_user_id INTEGER NOT NULL,
  from_user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_to_user
  ON notifications(to_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON notifications(created_at DESC);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id SERIAL PRIMARY KEY,
  notification_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  success INTEGER NOT NULL,
  status_code INTEGER,
  error_message TEXT,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notification
  ON notification_deliveries(notification_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_created_at
  ON notification_deliveries(created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions(user_id);

CREATE TABLE IF NOT EXISTS passkeys (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id BYTEA NOT NULL UNIQUE,
  public_key BYTEA NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT[],
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  last_used_at INTEGER,
  device_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_passkeys_user
  ON passkeys(user_id);

CREATE INDEX IF NOT EXISTS idx_passkeys_credential
  ON passkeys(credential_id);
