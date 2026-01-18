-- Migration: Add index for yos from_user_id query path
CREATE INDEX IF NOT EXISTS idx_yos_from_user_created_at_id
  ON yos(from_user_id, created_at DESC, id DESC);
