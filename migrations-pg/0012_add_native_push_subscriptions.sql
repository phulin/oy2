-- Extend push_subscriptions to support both web and native tokens.
ALTER TABLE push_subscriptions DROP CONSTRAINT push_subscriptions_pkey;

ALTER TABLE push_subscriptions
  ADD COLUMN platform TEXT NOT NULL DEFAULT 'web',
  ADD COLUMN native_token TEXT;

ALTER TABLE push_subscriptions
  ALTER COLUMN endpoint DROP NOT NULL,
  ALTER COLUMN keys_p256dh DROP NOT NULL,
  ALTER COLUMN keys_auth DROP NOT NULL;

ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_shape_check CHECK (
    (
      platform = 'web' AND
      endpoint IS NOT NULL AND
      keys_p256dh IS NOT NULL AND
      keys_auth IS NOT NULL AND
      native_token IS NULL
    ) OR (
      platform IN ('ios', 'android') AND
      native_token IS NOT NULL AND
      endpoint IS NULL AND
      keys_p256dh IS NULL AND
      keys_auth IS NULL
    )
  );

DROP INDEX IF EXISTS idx_push_subscriptions_endpoint;

CREATE UNIQUE INDEX idx_push_subscriptions_endpoint
  ON push_subscriptions(endpoint)
  WHERE endpoint IS NOT NULL;

CREATE UNIQUE INDEX idx_push_subscriptions_native_token
  ON push_subscriptions(native_token)
  WHERE native_token IS NOT NULL;

CREATE INDEX idx_push_subscriptions_user
  ON push_subscriptions(user_id);
