#!/usr/bin/env node

import { generateVAPIDKeys } from '../src/push.js';

console.log('Generating VAPID keys for push notifications...\n');
generateVAPIDKeys();
console.log('\nCopy these keys to your .env file or set them as Fly.io secrets.');
