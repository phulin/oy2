import { buildPushPayload } from '@block65/webcrypto-web-push';

const DEFAULT_VAPID_SUBJECT = 'mailto:admin@example.com';

function base64UrlEncode(buffer: Uint8Array) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  return Buffer.from(base64 + padding, 'base64');
}

/**
 * Send a push notification to a subscription (Cloudflare Workers-compatible).
 * @param {Object} env - Cloudflare Workers environment bindings
 * @param {Object} subscription - Push subscription object
 * @param {Object} payload - Notification payload
 */
export async function sendPushNotification(
  env: {
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
  },
  subscription: {
    endpoint: string;
    expirationTime: number | null;
    keys: { p256dh: string; auth: string };
  },
  payload: Record<string, unknown>
) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    throw new Error('VAPID keys not configured');
  }

  const vapid = {
    subject: env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };

  const message = {
    data: payload,
    options: {
      ttl: 60,
    },
  };

  const request = await buildPushPayload(message, subscription, vapid);
  const res = await fetch(subscription.endpoint, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  if (!res.ok) {
    const err = new Error(`Push failed with status ${res.status}`) as Error & {
      statusCode?: number;
    };
    err.statusCode = res.status;
    throw err;
  }

  return res;
}

/**
 * Generate VAPID keys for push notifications
 * Run this once and save the keys to your environment
 */
export async function generateVAPIDKeys() {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) {
    throw new Error('Web Crypto API not available');
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  if (!publicJwk.x || !publicJwk.y || !privateJwk.d) {
    throw new Error('Failed to export VAPID keys');
  }

  const publicKeyBytes = Buffer.concat([
    Buffer.from([0x04]),
    base64UrlDecode(publicJwk.x),
    base64UrlDecode(publicJwk.y),
  ]);

  return {
    publicKey: base64UrlEncode(publicKeyBytes),
    privateKey: privateJwk.d,
  };
}
