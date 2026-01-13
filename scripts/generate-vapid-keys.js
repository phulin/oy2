#!/usr/bin/env node

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  return Buffer.from(base64 + padding, 'base64');
}

async function generateVAPIDKeys() {
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

console.log('Generating VAPID keys for push notifications...\n');
const vapidKeys = await generateVAPIDKeys();
console.log('VAPID Public Key:', vapidKeys.publicKey);
console.log('VAPID Private Key:', vapidKeys.privateKey);
console.log('\nAdd these to your environment:');
console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
console.log('\nCopy these keys to your .env file or set them as Fly.io secrets.');
