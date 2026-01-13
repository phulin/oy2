# Oy - Send Oys to Your Friends

A minimalist social media app. Send simple "Oy" messages to your friends with push notifications.

## Features

- Super-fast server-side rendered PWA
- Send "Oy" to friends with one tap
- Real-time push notifications
- Offline support via Service Worker
- No authentication required (just username)
- Edge deployment on Cloudflare Workers

## Tech Stack

- **Frontend**: Vanilla JavaScript, SSR HTML, CSS
- **Backend**: Hono framework on Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite at the edge)
- **Push Notifications**: Web Push API
- **Deployment**: Cloudflare Workers
- **Package Manager**: Yarn 4

## Local Development

### Prerequisites

- Node.js 20+
- Yarn 4
- Cloudflare account (free tier works!)

### Setup

1. Install dependencies:

```bash
yarn install
```

2. Generate VAPID keys for push notifications:

```bash
yarn generate-vapid
```

This will output VAPID keys. Save them - you'll need them for deployment.

3. Create a D1 database:

```bash
yarn db:create
```

Copy the database ID from the output and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "oy2-db"
database_id = "YOUR_DATABASE_ID_HERE"
```

4. Run migrations to set up database schema:

```bash
yarn db:migrate:local
```

5. Set up secrets for local development:

Create a `.dev.vars` file in the root directory:

```bash
VAPID_PUBLIC_KEY=your_vapid_public_key_here
VAPID_PRIVATE_KEY=your_vapid_private_key_here
```

6. Start the development server:

```bash
yarn dev
```

The app will be available at [http://localhost:8787](http://localhost:8787)

## Production Deployment (Cloudflare Workers)

### Prerequisites

- Cloudflare account
- Wrangler CLI (installed with `yarn install`)

### First-time Deployment

1. Login to Cloudflare:

```bash
npx wrangler login
```

2. Create the D1 database:

```bash
yarn db:create
```

Copy the `database_id` from the output and update it in `wrangler.toml`.

3. Run migrations on the remote database:

```bash
yarn db:migrate
```

4. Set VAPID keys as secrets:

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
# Paste your public key when prompted

npx wrangler secret put VAPID_PRIVATE_KEY
# Paste your private key when prompted
```

5. Deploy:

```bash
yarn deploy
```

6. Oyur app is now live! Wrangler will output the URL (e.g., `https://oy2.your-subdomain.workers.dev`)

### Updating the Deployment

```bash
yarn deploy
```

### View Logs

```bash
npx wrangler tail
```

### Managing the Database

View your database:
```bash
npx wrangler d1 execute oy2-db --remote --command "SELECT * FROM users"
```

Create new migrations:
```bash
npx wrangler d1 migrations create oy2-db migration_name
```

## Project Structure

```
oy2/
├── src/
│   ├── index.js         # Hono app for Cloudflare Workers
│   ├── push.js          # Web Push notification logic
│   └── views.js         # Server-side rendered HTML templates
├── public/
│   ├── css/
│   │   └── app.css      # Minimal CSS styling
│   ├── js/
│   │   └── app.js       # Client-side vanilla JavaScript
│   ├── sw.js            # Service Worker for PWA
│   ├── manifest.json    # PWA manifest
│   └── icon.svg         # App icon
├── migrations/
│   └── 0001_initial_schema.sql  # D1 database schema
├── scripts/
│   └── generate-vapid-keys.js   # Helper to generate VAPID keys
├── wrangler.toml        # Cloudflare Workers configuration
└── package.json         # Dependencies and scripts
```

## API Endpoints

### Users

- `POST /api/users` - Create or get user
- `GET /api/users/search?q=<query>` - Search users

### Friends

- `POST /api/friends` - Add a friend
- `GET /api/friends` - Get friends list

### Oys

- `POST /api/oy` - Send an Oy
- `GET /api/oys` - Get recent Oys received

### Push Notifications

- `GET /api/push/vapid-public-key` - Get VAPID public key
- `POST /api/push/subscribe` - Subscribe to push notifications
- `POST /api/push/unsubscribe` - Unsubscribe from push notifications

## Database Schema

### users
- `id` - Auto-increment primary key
- `username` - Unique username
- `created_at` - Timestamp

### friendships
- `user_id` - User ID
- `friend_id` - Friend's user ID
- `created_at` - Timestamp

### yos
- `id` - Auto-increment primary key
- `from_user_id` - Sender's user ID
- `to_user_id` - Recipient's user ID
- `created_at` - Timestamp

### push_subscriptions
- `user_id` - User ID
- `endpoint` - Push subscription endpoint
- `keys_p256dh` - P256DH key
- `keys_auth` - Auth key
- `created_at` - Timestamp

## Why Cloudflare Workers?

- **Global Edge Network**: Oyur app runs on Cloudflare's edge, close to your users worldwide
- **Zero Cold Starts**: Workers start instantly
- **D1 Database**: SQLite at the edge with low latency
- **Free Tier**: 100,000 requests/day and 5GB storage on the free plan
- **No Server Management**: Focus on code, not infrastructure
- **Fast Deployment**: Deploy in seconds with `yarn deploy`

## Icons

The app includes a simple SVG icon at `/public/icon.svg`. To generate PNG icons:

```bash
# Install imagemagick if you haven't
brew install imagemagick  # macOS
# or
sudo apt-get install imagemagick  # Linux

# Generate PNG icons
convert public/icon.svg -resize 192x192 public/icon-192.png
convert public/icon.svg -resize 512x512 public/icon-512.png
```

## License

MIT
