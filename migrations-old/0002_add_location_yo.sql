-- Migration: Add type and payload columns to yos for location messages
ALTER TABLE yos ADD COLUMN type TEXT DEFAULT 'oy';
ALTER TABLE yos ADD COLUMN payload TEXT;
