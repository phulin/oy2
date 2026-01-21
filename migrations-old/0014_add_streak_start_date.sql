-- Store streak start date (NY timezone) for computed streak length.
ALTER TABLE friendships ADD COLUMN streak_start_date INTEGER;
