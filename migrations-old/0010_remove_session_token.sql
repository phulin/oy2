-- Migration: Remove legacy session_token from users
ALTER TABLE users DROP COLUMN session_token;
