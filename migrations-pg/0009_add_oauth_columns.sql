-- Add OAuth provider columns to users table
ALTER TABLE users ADD COLUMN oauth_provider TEXT;
ALTER TABLE users ADD COLUMN oauth_sub TEXT;
ALTER TABLE users ADD COLUMN email TEXT;

-- Index for looking up users by OAuth provider + sub
CREATE UNIQUE INDEX idx_users_oauth ON users(oauth_provider, oauth_sub)
  WHERE oauth_provider IS NOT NULL;
