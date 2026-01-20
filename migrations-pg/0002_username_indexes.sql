-- PostgreSQL username indexes for case-insensitive search

-- Enable trigram extension for ILIKE optimization
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Case-insensitive unique constraint using LOWER()
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
  ON users (LOWER(username));

-- GIN trigram index for fast ILIKE pattern matching
CREATE INDEX IF NOT EXISTS idx_users_username_trgm
  ON users USING GIN (username gin_trgm_ops);
