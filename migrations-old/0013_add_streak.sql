-- Add streak column to friendships table (default 1 for all friendships)
ALTER TABLE friendships ADD COLUMN streak INTEGER DEFAULT 1 NOT NULL;
