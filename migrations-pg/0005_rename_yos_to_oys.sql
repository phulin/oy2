-- Rename yos table to oys
ALTER TABLE yos RENAME TO oys;

-- Rename indexes
ALTER INDEX idx_yos_to_user RENAME TO idx_oys_to_user;
ALTER INDEX idx_yos_to_user_created_at_id RENAME TO idx_oys_to_user_created_at_id;
ALTER INDEX idx_yos_from_user_created_at_id RENAME TO idx_oys_from_user_created_at_id;
