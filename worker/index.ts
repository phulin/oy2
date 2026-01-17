import { Hono } from "hono";
import { sendPushNotification } from "./push";

type Bindings = {
	DB: D1Database;
	VAPID_PUBLIC_KEY: string;
	VAPID_PRIVATE_KEY: string;
	VAPID_SUBJECT?: string;
	TEXTBELT_API_KEY: string;
	SETTINGS: KVNamespace;
};

type User = {
	id: number;
	username: string;
	created_at?: number;
	phone?: string | null;
	phone_verified?: number | null;
	admin?: number | null;
	last_seen?: number | null;
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

type PushPayload = {
	title: string;
	body: string;
	icon?: string;
	badge?: string;
	type: "oy" | "lo";
	tag?: string;
	url?: string;
	notificationId?: number;
};

type YoRow = {
	id: number;
	from_user_id: number;
	to_user_id: number;
	type: string | null;
	payload: string | null;
	created_at: number;
	from_username: string;
	to_username: string;
};

type OysCursor = {
	before: number;
	beforeId: number;
};

const app = new Hono<{
	Bindings: Bindings;
	Variables: {
		user: User | null;
		sessionToken: string | null;
		bootMs: number;
	};
}>();

const PUSH_MAX_ATTEMPTS = 3;
const PUSH_BACKOFF_MS = 250;
const PUSH_BACKOFF_MULTIPLIER = 2;
const PHONE_AUTH_KV_KEY = "phone_auth_enabled";
const bootTime = performance.now();

const delay = (ms: number) =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

async function getPhoneAuthEnabled(env: Bindings) {
	const stored = await env.SETTINGS.get(PHONE_AUTH_KV_KEY);
	if (stored === null) {
		return true;
	}
	return stored === "true";
}

async function setPhoneAuthEnabled(env: Bindings, enabled: boolean) {
	await env.SETTINGS.put(PHONE_AUTH_KV_KEY, enabled ? "true" : "false");
}

async function recordDeliveryAttempt(
	env: Bindings,
	{
		notificationId,
		endpoint,
		attempt,
		success,
		statusCode,
		errorMessage,
	}: {
		notificationId: number;
		endpoint: string;
		attempt: number;
		success: boolean;
		statusCode?: number;
		errorMessage?: string;
	},
) {
	await env.DB.prepare(
		`
    INSERT INTO notification_deliveries
      (notification_id, endpoint, attempt, success, status_code, error_message)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
	)
		.bind(
			notificationId,
			endpoint,
			attempt,
			success ? 1 : 0,
			statusCode ?? null,
			errorMessage ?? null,
		)
		.run();
}

async function sendPushWithRetry(
	env: Bindings,
	subscription: {
		endpoint: string;
		expirationTime: number | null;
		keys: { p256dh: string; auth: string };
	},
	payload: PushPayload,
	notificationId: number,
) {
	let lastStatusCode: number | undefined;
	for (let attempt = 1; attempt <= PUSH_MAX_ATTEMPTS; attempt += 1) {
		try {
			const response = await sendPushNotification(env, subscription, payload);
			await recordDeliveryAttempt(env, {
				notificationId,
				endpoint: subscription.endpoint,
				attempt,
				success: true,
				statusCode: response.status,
			});
			return { delivered: true };
		} catch (err) {
			const statusCode = (err as { statusCode?: number }).statusCode;
			lastStatusCode = statusCode;
			const errorMessage = err instanceof Error ? err.message : String(err);
			await recordDeliveryAttempt(env, {
				notificationId,
				endpoint: subscription.endpoint,
				attempt,
				success: false,
				statusCode,
				errorMessage,
			});
			if (statusCode === 410) {
				return { delivered: false, statusCode };
			}
			if (attempt < PUSH_MAX_ATTEMPTS) {
				const backoff =
					PUSH_BACKOFF_MS * PUSH_BACKOFF_MULTIPLIER ** (attempt - 1);
				await delay(backoff);
			}
		}
	}

	return { delivered: false, statusCode: lastStatusCode };
}

// Middleware to get current user from header
app.use("*", async (c, next) => {
	const bootMs = performance.now() - bootTime;
	const handlerStart = performance.now();
	c.set("bootMs", bootMs);
	await next();
	const handlerMs = performance.now() - handlerStart;
	c.header(
		"Server-Timing",
		`boot;dur=${bootMs.toFixed(1)}, handler;dur=${handlerMs.toFixed(1)}`,
	);
});

app.use("*", async (c, next) => {
	c.set("user", null);
	c.set("sessionToken", null);
	const sessionToken = c.req.header("x-session-token");
	if (sessionToken) {
		try {
			const user = (await c.env.DB.prepare(
				`SELECT users.*
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token = ?`,
			)
				.bind(sessionToken)
				.first()) as User | null;
			c.set("user", user ?? null);
			if (user) {
				c.set("sessionToken", sessionToken);
				const now = Math.floor(Date.now() / 1000);
				await c.env.DB.prepare("UPDATE users SET last_seen = ? WHERE id = ?")
					.bind(now, user.id)
					.run();
			}
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
	const response = await fetch("https://textbelt.com/otp/generate", {
		method: "POST",
		body: new URLSearchParams({
			phone,
			userid: username,
			key: env.TEXTBELT_API_KEY,
			message: "Your Oy verification code is $OTP",
		}),
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

	let user = (await c.env.DB.prepare(
		"SELECT * FROM users WHERE username COLLATE NOCASE = ?",
	)
		.bind(trimmedUsername)
		.first()) as User | null;

	const phoneAuthEnabled = await getPhoneAuthEnabled(c.env);
	if (!phoneAuthEnabled) {
		if (!user) {
			const result = await c.env.DB.prepare(
				"INSERT INTO users (username, phone, phone_verified) VALUES (?, ?, 0)",
			)
				.bind(trimmedUsername, trimmedPhone || null)
				.run();
			user = (await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
				.bind(result.meta.last_row_id)
				.first()) as User | null;
		} else if (trimmedPhone && trimmedPhone !== user.phone) {
			await c.env.DB.prepare("UPDATE users SET phone = ? WHERE id = ?")
				.bind(trimmedPhone, user.id)
				.run();
		}

		if (!user) {
			return c.json({ error: "User not found" }, 404);
		}

		const sessionToken = crypto.randomUUID();
		const now = Math.floor(Date.now() / 1000);
		await c.env.DB.prepare("UPDATE users SET last_seen = ? WHERE id = ?")
			.bind(now, user.id)
			.run();
		await c.env.DB.prepare(
			"INSERT INTO sessions (token, user_id) VALUES (?, ?)",
		)
			.bind(sessionToken, user.id)
			.run();

		return c.json({
			status: "authenticated",
			user: {
				id: user.id,
				username: user.username,
				...(user.admin ? { admin: true } : {}),
			},
			token: sessionToken,
		});
	}

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

	const user = (await c.env.DB.prepare(
		"SELECT * FROM users WHERE username COLLATE NOCASE = ?",
	)
		.bind(trimmedUsername)
		.first()) as User | null;

	if (!user) {
		return c.json({ error: "User not found" }, 404);
	}

	const phoneAuthEnabled = await getPhoneAuthEnabled(c.env);
	if (!phoneAuthEnabled) {
		const sessionToken = crypto.randomUUID();
		const now = Math.floor(Date.now() / 1000);
		await c.env.DB.prepare("UPDATE users SET last_seen = ? WHERE id = ?")
			.bind(now, user.id)
			.run();
		await c.env.DB.prepare(
			"INSERT INTO sessions (token, user_id) VALUES (?, ?)",
		)
			.bind(sessionToken, user.id)
			.run();
		return c.json({
			user: {
				id: user.id,
				username: user.username,
				...(user.admin ? { admin: true } : {}),
			},
			token: sessionToken,
		});
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
	const now = Math.floor(Date.now() / 1000);
	await c.env.DB.prepare(
		"UPDATE users SET phone_verified = 1, last_seen = ? WHERE id = ?",
	)
		.bind(now, user.id)
		.run();
	await c.env.DB.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)")
		.bind(sessionToken, user.id)
		.run();

	return c.json({
		user: {
			id: user.id,
			username: user.username,
			...(user.admin ? { admin: true } : {}),
		},
		token: sessionToken,
	});
});

app.get("/api/auth/session", async (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	return c.json({
		user: {
			id: user.id,
			username: user.username,
			...(user.admin ? { admin: true } : {}),
		},
	});
});

app.post("/api/auth/logout", async (c) => {
	const user = c.get("user");
	const sessionToken = c.get("sessionToken");
	if (!user || !sessionToken) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	await c.env.DB.prepare("DELETE FROM sessions WHERE token = ?")
		.bind(sessionToken)
		.run();

	return c.json({ success: true });
});

// Create or get user
app.post("/api/users", async (c) => {
	const { username } = await c.req.json();
	const trimmedUsername = String(username || "").trim();

	if (
		!trimmedUsername ||
		trimmedUsername.length < 2 ||
		trimmedUsername.length > 20
	) {
		return c.json({ error: "Username must be 2-20 characters" }, 400);
	}

	// Check if user exists
	let user = (await c.env.DB.prepare(
		"SELECT * FROM users WHERE username COLLATE NOCASE = ?",
	)
		.bind(trimmedUsername)
		.first()) as User | null;

	if (!user) {
		try {
			const result = await c.env.DB.prepare(
				"INSERT INTO users (username) VALUES (?)",
			)
				.bind(trimmedUsername)
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
	const trimmedQuery = q?.trim() ?? "";

	if (!trimmedQuery || trimmedQuery.length < 2) {
		return c.json({ users: [] });
	}

	const users = await c.env.DB.prepare(
		"SELECT id, username FROM users WHERE username COLLATE NOCASE LIKE ? LIMIT 20",
	)
		.bind(`%${trimmedQuery}%`)
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
      f.last_yo_type,
      f.last_yo_created_at,
      f.last_yo_from_user_id
    FROM friendships f
    INNER JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ?
    ORDER BY u.username
  `,
	)
		.bind(user.id)
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
	const createdAt = Math.floor(Date.now() / 1000);
	const result = await c.env.DB.prepare(`
    INSERT INTO yos (from_user_id, to_user_id, type, payload, created_at)
    VALUES (?, ?, 'oy', NULL, ?)
  `)
		.bind(user.id, toUserId, createdAt)
		.run();
	const yoId = Number(result.meta.last_row_id);

	await c.env.DB.prepare(
		`
    UPDATE friendships
    SET last_yo_id = ?,
        last_yo_type = ?,
        last_yo_created_at = ?,
        last_yo_from_user_id = ?
    WHERE (user_id = ? AND friend_id = ?)
       OR (user_id = ? AND friend_id = ?)
  `,
	)
		.bind(yoId, "oy", createdAt, user.id, user.id, toUserId, toUserId, user.id)
		.run();

	const notificationPayload: PushPayload = {
		title: "Oy!",
		body: `${user.username} sent you an Oy!`,
		icon: "/icon-192.png",
		badge: "/icon-192.png",
		type: "oy",
	};

	const notificationRecord = await c.env.DB.prepare(
		`
    INSERT INTO notifications (to_user_id, from_user_id, type, payload)
    VALUES (?, ?, ?, ?)
  `,
	)
		.bind(toUserId, user.id, "oy", JSON.stringify(notificationPayload))
		.run();
	const notificationId = Number(notificationRecord.meta.last_row_id);
	const deliveryPayload: PushPayload = {
		...notificationPayload,
		notificationId,
		tag: `notification-${notificationId}`,
	};

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

			const { delivered, statusCode } = await sendPushWithRetry(
				c.env,
				subscription,
				deliveryPayload,
				notificationId,
			);
			if (!delivered) {
				console.error("Failed to send push:", statusCode);
				if (statusCode === 410) {
					await c.env.DB.prepare(
						"DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
					)
						.bind(toUserId, sub.endpoint)
						.run();
				}
			}
		}
	} catch (err) {
		console.error("Push notification error:", err);
	}

	return c.json({ success: true, yoId });
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
    SELECT y.id, y.from_user_id, y.to_user_id, y.type, y.payload, y.created_at,
           u_from.username as from_username,
           u_to.username as to_username
    FROM yos y
    INNER JOIN users u_from ON y.from_user_id = u_from.id
    INNER JOIN users u_to ON y.to_user_id = u_to.id
    WHERE (y.to_user_id = ? OR y.from_user_id = ?)
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

	const createdAt = Math.floor(Date.now() / 1000);
	const result = await c.env.DB.prepare(`
    INSERT INTO yos (from_user_id, to_user_id, type, payload, created_at)
    VALUES (?, ?, 'lo', ?, ?)
  `)
		.bind(user.id, toUserId, payload, createdAt)
		.run();
	const yoId = Number(result.meta.last_row_id);

	await c.env.DB.prepare(
		`
    UPDATE friendships
    SET last_yo_id = ?,
        last_yo_type = ?,
        last_yo_created_at = ?,
        last_yo_from_user_id = ?
    WHERE (user_id = ? AND friend_id = ?)
       OR (user_id = ? AND friend_id = ?)
  `,
	)
		.bind(yoId, "lo", createdAt, user.id, user.id, toUserId, toUserId, user.id)
		.run();

	const notificationPayload: PushPayload = {
		title: "Lo!",
		body: `${user.username} shared a location`,
		icon: "/icon-192.png",
		badge: "/icon-192.png",
		type: "lo",
		url: `/?tab=oys&yo=${yoId}&expand=location`,
	};

	const notificationRecord = await c.env.DB.prepare(
		`
    INSERT INTO notifications (to_user_id, from_user_id, type, payload)
    VALUES (?, ?, ?, ?)
  `,
	)
		.bind(toUserId, user.id, "lo", JSON.stringify(notificationPayload))
		.run();
	const notificationId = Number(notificationRecord.meta.last_row_id);
	const deliveryPayload: PushPayload = {
		...notificationPayload,
		notificationId,
		tag: `notification-${notificationId}`,
	};

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

			const { delivered, statusCode } = await sendPushWithRetry(
				c.env,
				subscription,
				deliveryPayload,
				notificationId,
			);
			if (!delivered) {
				console.error("Failed to send push:", statusCode);
				if (statusCode === 410) {
					await c.env.DB.prepare(
						"DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
					)
						.bind(toUserId, sub.endpoint)
						.run();
				}
			}
		}
	} catch (err) {
		console.error("Push notification error:", err);
	}

	return c.json({ success: true, yoId });
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

	await c.env.DB.batch([
		c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(
			endpoint,
		),
		c.env.DB.prepare(
			`
      INSERT OR REPLACE INTO push_subscriptions
        (user_id, endpoint, keys_p256dh, keys_auth)
      VALUES (?, ?, ?, ?)
    `,
		).bind(user.id, endpoint, keys.p256dh, keys.auth),
	]);

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

function requireAdmin(c: { get: (key: "user") => User | null }) {
	const user = c.get("user");
	if (!user) {
		return {
			ok: false,
			response: { error: "Not authenticated" },
			status: 401 as const,
		};
	}
	if (!user.admin) {
		return {
			ok: false,
			response: { error: "Not authorized" },
			status: 403 as const,
		};
	}
	return { ok: true, user };
}

app.get("/api/admin/stats", async (c) => {
	const adminCheck = requireAdmin(c);
	if (!adminCheck.ok) {
		return c.json(adminCheck.response, adminCheck.status);
	}

	const now = Math.floor(Date.now() / 1000);
	const since = now - 60 * 60 * 24;

	const activeUsersQuery = await c.env.DB.prepare(
		`
    SELECT id, username, last_seen
    FROM users
    WHERE last_seen >= ?
      AND EXISTS (
        SELECT 1 FROM sessions WHERE sessions.user_id = users.id
      )
    ORDER BY last_seen DESC
  `,
	)
		.bind(since)
		.all();

	const notificationsQuery = await c.env.DB.prepare(
		"SELECT COUNT(*) as count FROM notifications WHERE created_at >= ?",
	)
		.bind(since)
		.first();

	const deliveriesQuery = await c.env.DB.prepare(
		`
    SELECT
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
      COUNT(*) as total_count
    FROM notification_deliveries
    WHERE created_at >= ?
  `,
	)
		.bind(since)
		.first();

	const usersCountQuery = await c.env.DB.prepare(
		"SELECT COUNT(*) as count FROM users",
	).first();

	const subscriptionsCountQuery = await c.env.DB.prepare(
		"SELECT COUNT(*) as count FROM push_subscriptions",
	).first();

	const notificationsSent = Number(
		(notificationsQuery as { count?: number | null } | null)?.count ?? 0,
	);
	const totalDeliveries = Number(
		(deliveriesQuery as { total_count?: number | null } | null)?.total_count ??
			0,
	);
	const successDeliveries = Number(
		(deliveriesQuery as { success_count?: number | null } | null)
			?.success_count ?? 0,
	);

	const stats = {
		activeUsersCount: (activeUsersQuery.results || []).length,
		notificationsSent,
		deliveryAttempts: totalDeliveries,
		deliverySuccessCount: successDeliveries,
		deliveryFailureCount: Math.max(0, totalDeliveries - successDeliveries),
		deliverySuccessRate: totalDeliveries
			? successDeliveries / totalDeliveries
			: 0,
		subscriptionsCount: Number(
			(subscriptionsCountQuery as { count?: number | null } | null)?.count ?? 0,
		),
		usersCount: Number(
			(usersCountQuery as { count?: number | null } | null)?.count ?? 0,
		),
	};

	return c.json({
		stats,
		activeUsers: (activeUsersQuery.results || []) as Array<{
			id: number;
			username: string;
			last_seen: number;
		}>,
		generatedAt: now,
	});
});

app.get("/api/admin/phone-auth", async (c) => {
	const adminCheck = requireAdmin(c);
	if (!adminCheck.ok) {
		return c.json(adminCheck.response, adminCheck.status);
	}

	const enabled = await getPhoneAuthEnabled(c.env);
	return c.json({ enabled });
});

app.put("/api/admin/phone-auth", async (c) => {
	const adminCheck = requireAdmin(c);
	if (!adminCheck.ok) {
		return c.json(adminCheck.response, adminCheck.status);
	}

	const { enabled } = await c.req.json();
	if (typeof enabled !== "boolean") {
		return c.json({ error: "Missing enabled flag" }, 400);
	}

	await setPhoneAuthEnabled(c.env, enabled);
	return c.json({ enabled });
});

// Export the app as a Worker
export default app;
