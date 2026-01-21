-- Migration: Add denormalized last yo fields to friendships
ALTER TABLE friendships ADD COLUMN last_yo_id INTEGER;
ALTER TABLE friendships ADD COLUMN last_yo_type TEXT;
ALTER TABLE friendships ADD COLUMN last_yo_created_at INTEGER;
ALTER TABLE friendships ADD COLUMN last_yo_from_user_id INTEGER;

UPDATE friendships
SET last_yo_id = (
    SELECT y.id
    FROM yos y
    WHERE (y.from_user_id = friendships.user_id AND y.to_user_id = friendships.friend_id)
       OR (y.from_user_id = friendships.friend_id AND y.to_user_id = friendships.user_id)
    ORDER BY y.created_at DESC, y.id DESC
    LIMIT 1
  ),
  last_yo_type = (
    SELECT y.type
    FROM yos y
    WHERE (y.from_user_id = friendships.user_id AND y.to_user_id = friendships.friend_id)
       OR (y.from_user_id = friendships.friend_id AND y.to_user_id = friendships.user_id)
    ORDER BY y.created_at DESC, y.id DESC
    LIMIT 1
  ),
  last_yo_created_at = (
    SELECT y.created_at
    FROM yos y
    WHERE (y.from_user_id = friendships.user_id AND y.to_user_id = friendships.friend_id)
       OR (y.from_user_id = friendships.friend_id AND y.to_user_id = friendships.user_id)
    ORDER BY y.created_at DESC, y.id DESC
    LIMIT 1
  ),
  last_yo_from_user_id = (
    SELECT y.from_user_id
    FROM yos y
    WHERE (y.from_user_id = friendships.user_id AND y.to_user_id = friendships.friend_id)
       OR (y.from_user_id = friendships.friend_id AND y.to_user_id = friendships.user_id)
    ORDER BY y.created_at DESC, y.id DESC
    LIMIT 1
  );
