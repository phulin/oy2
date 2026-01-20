-- Rename last_yo_info table to last_oy_info
ALTER TABLE last_yo_info RENAME TO last_oy_info;

-- Rename columns
ALTER TABLE last_oy_info RENAME COLUMN last_yo_id TO last_oy_id;
ALTER TABLE last_oy_info RENAME COLUMN last_yo_type TO last_oy_type;
ALTER TABLE last_oy_info RENAME COLUMN last_yo_created_at TO last_oy_created_at;
ALTER TABLE last_oy_info RENAME COLUMN last_yo_from_user_id TO last_oy_from_user_id;

-- Rename index
ALTER INDEX idx_last_yo_info_user RENAME TO idx_last_oy_info_user;
