import { Hono } from "hono";
import { sendPushNotification } from "./push";

type Bindings = {
	DB: D1Database;
	VAPID_PUBLIC_KEY: string;
	VAPID_PRIVATE_KEY: string;
	VAPID_SUBJECT?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Middleware to get current user from header
app.use("*", async (c, next) => {
	const username = c.req.header("x-username");
	if (username) {
		try {
			const user = await c.env.DB.prepare(
				"SELECT * FROM users WHERE username = ?",
			)
				.bind(username)
				.first();
			c.set("user", user);
		} catch (err) {
			console.error("Error fetching user:", err);
		}
	}
	await next();
});

// ============ API Routes ============

// Create or get user
app.post("/api/users", async (c) => {
	const { username } = await c.req.json();

	if (!username || username.length < 2 || username.length > 20) {
		return c.json({ error: "Username must be 2-20 characters" }, 400);
	}

	// Check if user exists
	let user = await c.env.DB.prepare("SELECT * FROM users WHERE username = ?")
		.bind(username)
		.first();

	if (!user) {
		try {
			const result = await c.env.DB.prepare(
				"INSERT INTO users (username) VALUES (?)",
			)
				.bind(username)
				.run();

			if (!result.success) {
				return c.json({ error: "Username already taken" }, 400);
			}

			user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
				.bind(result.meta.last_row_id)
				.first();
		} catch (_err) {
			return c.json({ error: "Username already taken" }, 400);
		}
	}

	return c.json({ user });
});

// Search users
app.get("/api/users/search", async (c) => {
	const q = c.req.query("q");

	if (!q || q.length < 2) {
		return c.json({ users: [] });
	}

	const users = await c.env.DB.prepare(
		"SELECT id, username FROM users WHERE username LIKE ? LIMIT 20",
	)
		.bind(`%${q}%`)
		.all();

	return c.json({ users: users.results || [] });
});

// Add friend
app.post("/api/friends", async (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const { friendId } = await c.req.json();

	if (!friendId || friendId === user.id) {
		return c.json({ error: "Invalid friend ID" }, 400);
	}

	// Check if friend exists
	const friend = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
		.bind(friendId)
		.first();

	if (!friend) {
		return c.json({ error: "User not found" }, 404);
	}

	// Add friendship (bidirectional)
	await c.env.DB.batch([
		c.env.DB.prepare(
			"INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)",
		).bind(user.id, friendId),
		c.env.DB.prepare(
			"INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)",
		).bind(friendId, user.id),
	]);

	return c.json({ success: true });
});

// Get friends
app.get("/api/friends", async (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const friends = await c.env.DB.prepare(`
    SELECT u.id, u.username
    FROM users u
    INNER JOIN friendships f ON u.id = f.friend_id
    WHERE f.user_id = ?
    ORDER BY u.username
  `)
		.bind(user.id)
		.all();

	return c.json({ friends: friends.results || [] });
});

// Send Oy
app.post("/api/oy", async (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const { toUserId } = await c.req.json();

	if (!toUserId) {
		return c.json({ error: "Missing toUserId" }, 400);
	}

	// Check if they're friends
	const areFriends = await c.env.DB.prepare(
		"SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ? LIMIT 1",
	)
		.bind(user.id, toUserId)
		.first();

	if (!areFriends) {
		return c.json({ error: "You can only send Oys to friends" }, 403);
	}

	// Create the Oy
	const result = await c.env.DB.prepare(`
    INSERT INTO yos (from_user_id, to_user_id, type, payload)
    VALUES (?, ?, 'oy', NULL)
  `)
		.bind(user.id, toUserId)
		.run();

	// Send push notification
	try {
		const subscriptions = await c.env.DB.prepare(`
      SELECT endpoint, keys_p256dh, keys_auth
      FROM push_subscriptions
      WHERE user_id = ?
    `)
			.bind(toUserId)
			.all();

		for (const sub of subscriptions.results || []) {
			const subscription = {
				endpoint: sub.endpoint,
				expirationTime: null,
				keys: {
					p256dh: sub.keys_p256dh,
					auth: sub.keys_auth,
				},
			};

			await sendPushNotification(c.env, subscription, {
				title: "Oy!",
				body: `${user.username} sent you an Oy!`,
				icon: "/icon-192.png",
				badge: "/icon-192.png",
				tag: `yo-${result.meta.last_row_id}`,
			}).catch(async (err) => {
				console.error("Failed to send push:", err);
				// If push fails (expired subscription), delete it
				if ((err as { statusCode?: number }).statusCode === 410) {
					await c.env.DB.prepare(
						"DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
					)
						.bind(toUserId, sub.endpoint)
						.run();
				}
			});
		}
	} catch (err) {
		console.error("Push notification error:", err);
	}

	return c.json({ success: true, yoId: result.meta.last_row_id });
});

// Get recent Oys
app.get("/api/oys", async (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const yos = await c.env.DB.prepare(`
    SELECT y.id, y.from_user_id, y.to_user_id, y.type, y.payload, y.created_at, u.username as from_username
    FROM yos y
    INNER JOIN users u ON y.from_user_id = u.id
    WHERE y.to_user_id = ?
    ORDER BY y.created_at DESC
    LIMIT 50
  `)
		.bind(user.id)
		.all();

	const results = (yos.results || []).map((yo) => ({
		...yo,
		payload: yo.payload ? JSON.parse(yo.payload) : null,
		type: yo.type || "oy",
	}));

	return c.json({ yos: results });
});

// Send location (Lo!)
app.post("/api/lo", async (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const { toUserId, location } = await c.req.json();
	const lat = Number(location?.lat);
	const lon = Number(location?.lon);

	if (!toUserId || !Number.isFinite(lat) || !Number.isFinite(lon)) {
		return c.json({ error: "Missing location" }, 400);
	}

	// Check if they're friends
	const areFriends = await c.env.DB.prepare(
		"SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ? LIMIT 1",
	)
		.bind(user.id, toUserId)
		.first();

	if (!areFriends) {
		return c.json({ error: "You can only send Los to friends" }, 403);
	}

	const payload = JSON.stringify({
		lat,
		lon,
		accuracy: location.accuracy || null,
	});

	const result = await c.env.DB.prepare(`
    INSERT INTO yos (from_user_id, to_user_id, type, payload)
    VALUES (?, ?, 'lo', ?)
  `)
		.bind(user.id, toUserId, payload)
		.run();

	try {
		const subscriptions = await c.env.DB.prepare(`
      SELECT endpoint, keys_p256dh, keys_auth
      FROM push_subscriptions
      WHERE user_id = ?
    `)
			.bind(toUserId)
			.all();

		for (const sub of subscriptions.results || []) {
			const subscription = {
				endpoint: sub.endpoint,
				expirationTime: null,
				keys: {
					p256dh: sub.keys_p256dh,
					auth: sub.keys_auth,
				},
			};

			const url = `/?tab=yos&yo=${result.meta.last_row_id}&expand=location`;

			await sendPushNotification(c.env, subscription, {
				title: "Lo!",
				body: `${user.username} shared a location`,
				icon: "/icon-192.png",
				badge: "/icon-192.png",
				tag: `lo-${result.meta.last_row_id}`,
				url,
			}).catch(async (err) => {
				console.error("Failed to send push:", err);
				if ((err as { statusCode?: number }).statusCode === 410) {
					await c.env.DB.prepare(
						"DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
					)
						.bind(toUserId, sub.endpoint)
						.run();
				}
			});
		}
	} catch (err) {
		console.error("Push notification error:", err);
	}

	return c.json({ success: true, yoId: result.meta.last_row_id });
});

// Subscribe to push notifications
app.post("/api/push/subscribe", async (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const { endpoint, keys } = await c.req.json();

	if (!endpoint || !keys?.p256dh || !keys?.auth) {
		return c.json({ error: "Invalid subscription" }, 400);
	}

	await c.env.DB.prepare(`
    INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth)
    VALUES (?, ?, ?, ?)
  `)
		.bind(user.id, endpoint, keys.p256dh, keys.auth)
		.run();

	return c.json({ success: true });
});

// Unsubscribe from push notifications
app.post("/api/push/unsubscribe", async (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const { endpoint } = await c.req.json();

	if (!endpoint) {
		return c.json({ error: "Missing endpoint" }, 400);
	}

	await c.env.DB.prepare(
		"DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
	)
		.bind(user.id, endpoint)
		.run();

	return c.json({ success: true });
});

// Get VAPID public key
app.get("/api/push/vapid-public-key", async (c) => {
	return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
});

// Export the app as a Worker
export default app;
