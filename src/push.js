import webpush from 'web-push';

/**
 * Send a push notification to a subscription
 * @param {Object} env - Cloudflare Workers environment bindings
 * @param {Object} subscription - Push subscription object
 * @param {Object} payload - Notification payload
 */
export async function sendPushNotification(env, subscription, payload) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    throw new Error('VAPID keys not configured');
  }

  // Configure web-push with VAPID keys
  webpush.setVapidDetails(
    'mailto:admin@example.com',
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );

  return webpush.sendNotification(subscription, JSON.stringify(payload));
}

/**
 * Generate VAPID keys for push notifications
 * Run this once and save the keys to your environment
 */
export function generateVAPIDKeys() {
  const vapidKeys = webpush.generateVAPIDKeys();
  console.log('VAPID Public Key:', vapidKeys.publicKey);
  console.log('VAPID Private Key:', vapidKeys.privateKey);
  console.log('\nAdd these to your environment:');
  console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
  return vapidKeys;
}

export default webpush;
