import { Hono } from "hono";
import { sendPushNotification } from "./push";

type Bindings = {
	DB: D1Database;
	VAPID_PUBLIC_KEY: string;
	VAPID_PRIVATE_KEY: string;
	VAPID_SUBJECT?: string;
	TEXTBELT_API_KEY: string;
};

type User = {
	id: number;
	username: string;
	created_at?: number;
	phone?: string | null;
	phone_verified?: number | null;
	session_token?: string | null;
};

type FriendUser = {
	id: number;
	username: string;
};

type FriendListRow = {
	id: number;
	username: string;
	last_yo_type: string | null;
	last_yo_created_at: number | null;
	last_yo_from_user_id: number | null;
};

type PushSubscriptionRow = {
	endpoint: string;
	keys_p256dh: string;
	keys_auth: string;
};

type YoRow = {
	id: number;
	from_user_id: number;
	to_user_id: number;
	type: string | null;
	payload: string | null;
	created_at: number;
	from_username: string;
};

type OysCursor = {
	before: number;
	beforeId: number;
};

const app = new Hono<{
	Bindings: Bindings;
	Variables: {
		user: User | null;
	};
}>();

// Middleware to get current user from header
app.use("*", async (c, next) => {
	c.set("user", null);
	const sessionToken = c.req.header("x-session-token");
	if (sessionToken) {
		try {
			const user = (await c.env.DB.prepare(
				"SELECT * FROM users WHERE session_token = ?",
			)
				.bind(sessionToken)
				.first()) as User | null;
			c.set("user", user ?? null);
		} catch (err) {
			console.error("Error fetching user:", err);
		}
	}
	await next();
});

async function sendOtp(
	env: Bindings,
	{ phone, username }: { phone: string; username: string },
) {
	const body = new URLSearchParams({
		phone,
		userid: username,
		key: env.TEXTBELT_API_KEY,
		message: "Your Oy verification code is $OTP",
	});

	const response = await fetch("https://textbelt.com/otp/generate", {
		method: "POST",
		body,
	});
	return response.json() as Promise<{
		success: boolean;
		quotaRemaining: number;
		otp: string;
	}>;
}

async function verifyOtp(
	env: Bindings,
	{ otp, username }: { otp: string; username: string },
) {
	const params = new URLSearchParams({
		otp,
		userid: username,
		key: env.TEXTBELT_API_KEY,
	});
	const response = await fetch(
		`https://textbelt.com/otp/verify?${params.toString()}`,
	);
	return response.json() as Promise<{ success: boolean; isValidOtp: boolean }>;
}

// ============ API Routes ============

app.post("/api/auth/start", async (c) => {
	const { username, phone } = await c.req.json();
	const trimmedUsername = String(username || "").trim();
	const trimmedPhone = String(phone || "").trim();

	if (
		!trimmedUsername ||
		trimmedUsername.length < 2 ||
		trimmedUsername.length > 20
	) {
		return c.json({ error: "Username must be 2-20 characters" }, 400);
	}

	let user = (await c.env.DB.prepare("SELECT * FROM users WHERE username = ?")
		.bind(trimmedUsername)
		.first()) as User | null;

	if (user?.phone) {
		const result = await sendOtp(c.env, {
			phone: user.phone,
			username: trimmedUsername,
		});
		if (!result.success) {
			return c.json({ error: "Unable to send verification code" }, 400);
		}
		return c.json({ status: "code_sent" });
	}

	if (!trimmedPhone) {
		return c.json({ status: "needs_phone" });
	}

	if (!user) {
		const result = await c.env.DB.prepare(
			"INSERT INTO users (username, phone, phone_verified) VALUES (?, ?, 0)",
		)
			.bind(trimmedUsername, trimmedPhone)
			.run();

		user = (await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
			.bind(result.meta.last_row_id)
			.first()) as User | null;
	} else {
		await c.env.DB.prepare(
			"UPDATE users SET phone = ?, phone_verified = 0 WHERE id = ?",
		)
			.bind(trimmedPhone, user.id)
			.run();
	}

	const result = await sendOtp(c.env, {
		phone: trimmedPhone,
		username: trimmedUsername,
	});
	if (!result.success) {
		return c.json({ error: "Unable to send verification code" }, 400);
	}

	return c.json({ status: "code_sent" });
});

app.post("/api/auth/verify", async (c) => {
	const { username, otp } = await c.req.json();
	const trimmedUsername = String(username || "").trim();
	const trimmedOtp = String(otp || "").trim();

	if (!trimmedUsername || !trimmedOtp) {
		return c.json({ error: "Missing verification code" }, 400);
	}

	const user = (await c.env.DB.prepare("SELECT * FROM users WHERE username = ?")
		.bind(trimmedUsername)
		.first()) as User | null;

	if (!user) {
		return c.json({ error: "User not found" }, 404);
	}

	const result = await verifyOtp(c.env, {
		otp: trimmedOtp,
		username: trimmedUsername,
	});

	if (!result.success) {
		return c.json({ error: "Verification failed" }, 400);
	}

	if (!result.isValidOtp) {
		return c.json({ error: "Invalid verification code" }, 400);
	}

	const sessionToken = crypto.randomUUID();
	await c.env.DB.prepare(
		"UPDATE users SET phone_verified = 1, session_token = ? WHERE id = ?",
	)
		.bind(sessionToken, user.id)
		.run();

	return c.json({
		user: { id: user.id, username: user.username },
		token: sessionToken,
	});
});

app.get("/api/auth/session", async (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	return c.json({ user: { id: user.id, username: user.username } });
});

app.post("/api/auth/logout", async (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	await c.env.DB.prepare("UPDATE users SET session_token = NULL WHERE id = ?")
		.bind(user.id)
		.run();

	return c.json({ success: true });
});

// Create or get user
app.post("/api/users", async (c) => {
	const { username } = await c.req.json();

	if (!username || username.length < 2 || username.length > 20) {
		return c.json({ error: "Username must be 2-20 characters" }, 400);
	}

	// Check if user exists
	let user = (await c.env.DB.prepare("SELECT * FROM users WHERE username = ?")
		.bind(username)
		.first()) as User | null;

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

			user = (await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
				.bind(result.meta.last_row_id)
				.first()) as User | null;
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

	const userResults = (users.results || []) as FriendUser[];
	return c.json({ users: userResults });
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
	const friend = (await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
		.bind(friendId)
		.first()) as User | null;

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

	const friends = await c.env.DB.prepare(
		`
    SELECT
      u.id,
      u.username,
      (
        SELECT y.type
        FROM yos y
        WHERE (
          y.from_user_id = u.id AND y.to_user_id = ?
        ) OR (
          y.from_user_id = ? AND y.to_user_id = u.id
        )
        ORDER BY y.created_at DESC, y.id DESC
        LIMIT 1
      ) AS last_yo_type,
      (
        SELECT y.created_at
        FROM yos y
        WHERE (
          y.from_user_id = u.id AND y.to_user_id = ?
        ) OR (
          y.from_user_id = ? AND y.to_user_id = u.id
        )
        ORDER BY y.created_at DESC, y.id DESC
        LIMIT 1
      ) AS last_yo_created_at,
      (
        SELECT y.from_user_id
        FROM yos y
        WHERE (
          y.from_user_id = u.id AND y.to_user_id = ?
        ) OR (
          y.from_user_id = ? AND y.to_user_id = u.id
        )
        ORDER BY y.created_at DESC, y.id DESC
        LIMIT 1
      ) AS last_yo_from_user_id
    FROM users u
    INNER JOIN friendships f ON u.id = f.friend_id
    WHERE f.user_id = ?
    ORDER BY u.username
  `,
	)
		.bind(user.id, user.id, user.id, user.id, user.id, user.id, user.id)
		.all();

	const friendResults = (friends.results || []) as FriendListRow[];
	return c.json({ friends: friendResults });
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

		const subscriptionResults = (subscriptions.results ||
			[]) as PushSubscriptionRow[];
		for (const sub of subscriptionResults) {
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
				type: "oy",
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

	const beforeRaw = c.req.query("before");
	const beforeIdRaw = c.req.query("beforeId");
	const before = beforeRaw ? Number(beforeRaw) : Number.NaN;
	const beforeId = beforeIdRaw ? Number(beforeIdRaw) : Number.NaN;
	const hasCursor = Number.isFinite(before) && Number.isFinite(beforeId);
	const pageSize = 30;

	const yos = await c.env.DB.prepare(
		`
    SELECT y.id, y.from_user_id, y.to_user_id, y.type, y.payload, y.created_at, u.username as from_username
    FROM yos y
    INNER JOIN users u ON y.from_user_id = u.id
    WHERE y.to_user_id = ?
      AND (
        ? = 0
        OR y.created_at < ?
        OR (y.created_at = ? AND y.id < ?)
      )
    ORDER BY y.created_at DESC, y.id DESC
    LIMIT ?
  `,
	)
		.bind(
			user.id,
			hasCursor ? 1 : 0,
			hasCursor ? before : 0,
			hasCursor ? before : 0,
			hasCursor ? beforeId : 0,
			pageSize,
		)
		.all();

	const yoRows = (yos.results || []) as YoRow[];
	const results = yoRows.map((yo) => ({
		...yo,
		payload: yo.payload ? JSON.parse(yo.payload) : null,
		type: yo.type || "oy",
	}));

	const hasMore = results.length === pageSize;
	const last = results.at(-1);
	const nextCursor: OysCursor | null =
		hasMore && last ? { before: last.created_at, beforeId: last.id } : null;

	return c.json({ oys: results, nextCursor });
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

		const subscriptionResults = (subscriptions.results ||
			[]) as PushSubscriptionRow[];
		for (const sub of subscriptionResults) {
			const subscription = {
				endpoint: sub.endpoint,
				expirationTime: null,
				keys: {
					p256dh: sub.keys_p256dh,
					auth: sub.keys_auth,
				},
			};

			const url = `/?tab=oys&yo=${result.meta.last_row_id}&expand=location`;

			await sendPushNotification(c.env, subscription, {
				title: "Lo!",
				body: `${user.username} shared a location`,
				icon: "/icon-192.png",
				badge: "/icon-192.png",
				type: "lo",
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
