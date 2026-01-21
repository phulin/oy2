-- Create passkeys table for WebAuthn credentials
CREATE TABLE passkeys (
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

CREATE INDEX idx_passkeys_user ON passkeys(user_id);
CREATE INDEX idx_passkeys_credential ON passkeys(credential_id);
