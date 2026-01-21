-- Migration: Add indexes for query hot paths
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON notifications(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_created_at
  ON notification_deliveries(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
  ON push_subscriptions(endpoint);

CREATE INDEX IF NOT EXISTS idx_yos_to_user_created_at_id
  ON yos(to_user_id, created_at DESC, id DESC);
