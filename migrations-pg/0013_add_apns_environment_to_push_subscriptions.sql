ALTER TABLE push_subscriptions
  ADD COLUMN apns_environment TEXT CHECK (apns_environment IN ('sandbox', 'production'));

ALTER TABLE push_subscriptions
  DROP CONSTRAINT push_subscriptions_shape_check;

ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_shape_check CHECK (
    (
      platform = 'web' AND
      endpoint IS NOT NULL AND
      keys_p256dh IS NOT NULL AND
      keys_auth IS NOT NULL AND
      native_token IS NULL AND
      apns_environment IS NULL
    ) OR (
      platform = 'android' AND
      native_token IS NOT NULL AND
      endpoint IS NULL AND
      keys_p256dh IS NULL AND
      keys_auth IS NULL AND
      apns_environment IS NULL
    ) OR (
      platform = 'ios' AND
      native_token IS NOT NULL AND
      endpoint IS NULL AND
      keys_p256dh IS NULL AND
      keys_auth IS NULL
    )
  );
