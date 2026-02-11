# Oy - Send Oys to Your Friends

A minimalist social app for sending quick "Oy" taps (and optional location "Lo")
to friends with push notifications.

## Features

- One-tap Oys plus optional location shares
- Push notifications + offline-ready PWA
- Passkeys (WebAuthn), email codes, and Apple/Google OAuth sign-in
- Friend graph with streaks and last-seen info
- Cloudflare Workers at the edge with Postgres via Hyperdrive

## Tech Stack

- **Frontend**: SolidJS + Vite + vite-plugin-pwa
- **Backend**: Hono on Cloudflare Workers
- **Database**: Postgres (Cloudflare Hyperdrive)
- **KV**: Cloudflare KV (ephemeral auth + OAuth state)
- **Push**: Web Push API
- **Maps**: Leaflet + Google Geocoding API
- **Package Manager**: Yarn 4

## Local Development

### Prerequisites

- Node.js 20+
- Yarn 4
- Postgres
- Cloudflare account (for Hyperdrive/Workers)

### Setup

1. Install dependencies:

```bash
yarn install
```

2. Generate VAPID keys for push notifications:

```bash
node scripts/generate-vapid-keys.js
```

3. Configure environment variables for the worker:

Create a `.dev.vars` file in the repo root (used by Wrangler). Minimum
recommended variables are shown below; add OAuth credentials only if you want
to enable those sign-in options.

```bash
VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_PRIVATE_KEY=your_vapid_private_key
VAPID_SUBJECT=mailto:admin@example.com
RESEND_API_KEY=your_resend_key
GOOGLE_MAPS_API_KEY=your_google_maps_key
APPLE_CLIENT_ID=your_apple_client_id
APPLE_NATIVE_CLIENT_ID=your_ios_bundle_id
APPLE_TEAM_ID=your_apple_team_id
APPLE_KEY_ID=your_apple_key_id
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

4. Configure Hyperdrive + KV bindings:

Update `wrangler.toml` with your Hyperdrive and KV IDs for `dev` and `prod`.

5. Run database migrations locally:

```bash
DATABASE_URL=postgres://... yarn db:migrate:local
```

If `DATABASE_URL` is not set, the script connects to a local `oy2` database.

6. Start the dev server:

```bash
yarn dev
```

The app will be available at [http://localhost:5173](http://localhost:5173).

### Tests and Quality

```bash
yarn test
yarn check
yarn lint
yarn format
```

## Production Deployment (Cloudflare Workers)

1. Set secrets:

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put GOOGLE_MAPS_API_KEY
npx wrangler secret put APPLE_CLIENT_ID
npx wrangler secret put APPLE_NATIVE_CLIENT_ID
npx wrangler secret put APPLE_TEAM_ID
npx wrangler secret put APPLE_KEY_ID
npx wrangler secret put APPLE_PRIVATE_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

2. Run remote migrations:

```bash
yarn db:migrate:remote
```

3. Deploy:

```bash
yarn deploy
```

For the dev environment:

```bash
yarn deploy:dev
```

## Project Structure

```
oy2/
├── src/
│   ├── routes/                 # SolidJS routes
│   ├── components/             # UI components
│   ├── sw.ts                    # PWA service worker
│   └── main.tsx                 # Frontend entry
├── worker/
│   ├── routes/                  # Hono API routes
│   ├── index.ts                 # Worker entry
│   └── push.ts                  # Web Push helpers
├── migrations-pg/               # Postgres migrations
├── backup-worker/               # Export/backup worker
├── scripts/                     # Tooling (migrations, VAPID, etc.)
├── public/                      # Static assets + PWA manifest
├── wrangler.toml                # Cloudflare Workers config
├── production_schema.sql        # Production DB schema
└── package.json
```

## API Endpoints

### Auth

- `GET /api/auth/session`
- `POST /api/auth/logout`
- `POST /api/auth/email/send-code`
- `POST /api/auth/email/verify`
- `POST /api/auth/email/complete`
- `POST /api/auth/passkey/register/options`
- `POST /api/auth/passkey/register/verify`
- `POST /api/auth/passkey/auth/options`
- `POST /api/auth/passkey/auth/verify`
- `GET /api/auth/oauth/apple`
- `GET /api/auth/oauth/google`
- `POST /api/auth/oauth/callback`
- `POST /api/auth/oauth/complete`

### Users and Friends

- `GET /api/users/search`
- `GET /api/users/suggested`
- `POST /api/users/suggested/mutuals`
- `POST /api/friends`
- `GET /api/friends`
- `GET /api/last-oy-info`

### Oys

- `POST /api/oy`
- `POST /api/lo`
- `GET /api/oys`

### Push

- `POST /api/push/subscribe`
- `POST /api/push/unsubscribe`
- `GET /api/push/vapid-public-key`

### Admin

- `GET /api/admin/stats`

## Database Schema

Current production schema is tracked in `production_schema.sql`. Migrations live
in `migrations-pg/`.

## License

MIT
