import { Hono } from "hono";
import { sendPushNotification } from "./push";

type Bindings = {
	DB: D1Database;
	VAPID_PUBLIC_KEY: string;
	VAPID_PRIVATE_KEY: string;
	VAPID_SUBJECT?: string;
	TEXTBELT_API_KEY: string;
	OY2: KVNamespace;
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
	mutuals?: number;
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
const SETTINGS_KV_PREFIX = "settings:";
const PHONE_AUTH_KV_KEY = `${SETTINGS_KV_PREFIX}phone_auth_enabled`;
const SESSION_KV_PREFIX = "session:";
const PUSH_SUBSCRIPTIONS_KV_PREFIX = "push_subscriptions:";
const bootTime = performance.now();

const delay = (ms: number) =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

async function getPhoneAuthEnabled(env: Bindings) {
	const stored = await env.OY2.get(PHONE_AUTH_KV_KEY);
	if (stored === null) {
		return true;
	}
	return stored === "true";
}

async function setPhoneAuthEnabled(env: Bindings, enabled: boolean) {
	await env.OY2.put(PHONE_AUTH_KV_KEY, enabled ? "true" : "false");
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

async function sendPushNotifications({
	env,
	subscriptions,
	payload,
	notificationId,
	toUserId,
}: {
	env: Bindings;
	subscriptions: PushSubscriptionRow[];
	payload: PushPayload;
	notificationId: number;
	toUserId: number;
}) {
	try {
		let didMutateSubscriptions = false;
		for (const sub of subscriptions) {
			const subscription = {
				endpoint: sub.endpoint,
				expirationTime: null,
				keys: {
					p256dh: sub.keys_p256dh,
					auth: sub.keys_auth,
				},
			};

			const { delivered, statusCode } = await sendPushWithRetry(
				env,
				subscription,
				payload,
				notificationId,
			);
			if (!delivered) {
				console.error("Failed to send push:", statusCode);
				if (statusCode === 410) {
					await env.DB.prepare(
						"DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
					)
						.bind(toUserId, sub.endpoint)
						.run();
					didMutateSubscriptions = true;
				}
			}
		}
		if (didMutateSubscriptions) {
			await invalidatePushSubscriptionsCache(env, toUserId);
		}
	} catch (err) {
		console.error("Push notification error:", err);
	}
}

async function createYoAndNotification({
	env,
	fromUserId,
	toUserId,
	type,
	yoPayload,
	makeNotificationPayload,
}: {
	env: Bindings;
	fromUserId: number;
	toUserId: number;
	type: "oy" | "lo";
	yoPayload: string | null;
	makeNotificationPayload: (yoId: number) => PushPayload;
}) {
	const createdAt = Math.floor(Date.now() / 1000);
	const batchResults = await env.DB.batch([
		env.DB.prepare(
			`
      INSERT INTO yos (from_user_id, to_user_id, type, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
		).bind(fromUserId, toUserId, type, yoPayload, createdAt),
		env.DB.prepare(
			`
      UPDATE friendships
      SET last_yo_id = last_insert_rowid(),
          last_yo_type = ?,
          last_yo_created_at = ?,
          last_yo_from_user_id = ?
      WHERE (user_id = ? AND friend_id = ?)
         OR (user_id = ? AND friend_id = ?)
    `,
		).bind(
			type,
			createdAt,
			fromUserId,
			fromUserId,
			toUserId,
			toUserId,
			fromUserId,
		),
	]);

	const yoId = Number(batchResults[0].meta.last_row_id);
	const notificationPayload = makeNotificationPayload(yoId);
	const notificationInsert = await env.DB.prepare(
		`
      INSERT INTO notifications (to_user_id, from_user_id, type, payload)
      VALUES (?, ?, ?, ?)
    `,
	)
		.bind(toUserId, fromUserId, type, JSON.stringify(notificationPayload))
		.run();
	const notificationId = Number(notificationInsert.meta.last_row_id);
	const subscriptions = await fetchPushSubscriptions(env, toUserId);

	const deliveryPayload: PushPayload = {
		...notificationPayload,
		notificationId,
		tag: `notification-${notificationId}`,
	};

	return {
		yoId,
		notificationId,
		deliveryPayload,
		subscriptions,
	};
}

function pushSubscriptionsCacheKey(userId: number) {
	return `${PUSH_SUBSCRIPTIONS_KV_PREFIX}${userId}`;
}

async function fetchPushSubscriptions(env: Bindings, userId: number) {
	const cacheKey = pushSubscriptionsCacheKey(userId);
	const cached = await env.OY2.get(cacheKey, "json");
	if (cached) {
		return cached as PushSubscriptionRow[];
	}

	const subscriptionResults = await env.DB.prepare(
		`
      SELECT endpoint, keys_p256dh, keys_auth
      FROM push_subscriptions
      WHERE user_id = ?
    `,
	)
		.bind(userId)
		.all();

	const subscriptions = (subscriptionResults.results ||
		[]) as PushSubscriptionRow[];
	await env.OY2.put(cacheKey, JSON.stringify(subscriptions));
	return subscriptions;
}

async function invalidatePushSubscriptionsCache(env: Bindings, userId: number) {
	await env.OY2.delete(pushSubscriptionsCacheKey(userId));
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
			const sessionKey = `${SESSION_KV_PREFIX}${sessionToken}`;
			const cachedUser = await c.env.OY2.get(sessionKey, "json");
			const user =
				(cachedUser as User | null) ??
				((await c.env.DB.prepare(
					`SELECT users.*
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token = ?`,
				)
					.bind(sessionToken)
					.first()) as User | null);
			c.set("user", user ?? null);
			if (user) {
				c.set("sessionToken", sessionToken);
				const now = Math.floor(Date.now() / 1000);
				const updatePromise = c.env.DB.prepare(
					"UPDATE users SET last_seen = ? WHERE id = ?",
				)
					.bind(now, user.id)
					.run();
				let cachePromise: Promise<void> | null = null;
				if (!cachedUser) {
					const cachedUserValue = { ...user, last_seen: null };
					cachePromise = c.env.OY2.put(
						sessionKey,
						JSON.stringify(cachedUserValue),
					);
				}
				c.executionCtx.waitUntil(
					cachePromise
						? Promise.all([updatePromise, cachePromise])
						: updatePromise,
				);
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

function authUserPayload(user: User) {
	return {
		id: user.id,
		username: user.username,
		...(user.admin ? { admin: true } : {}),
	};
}

function normalizeUsername(username: unknown) {
	return String(username || "").trim();
}

function validateUsername(username: string) {
	if (!username || username.length < 2 || username.length > 20) {
		return "Username must be 2-20 characters";
	}
	return null;
}

async function createSession(env: Bindings, user: User) {
	const sessionToken = crypto.randomUUID();
	await env.DB.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)")
		.bind(sessionToken, user.id)
		.run();
	await env.OY2.put(
		`${SESSION_KV_PREFIX}${sessionToken}`,
		JSON.stringify(user),
	);
	return sessionToken;
}

async function fetchUserByUsername(env: Bindings, username: string) {
	return (await env.DB.prepare(
		"SELECT * FROM users WHERE username COLLATE NOCASE = ?",
	)
		.bind(username)
		.first()) as User | null;
}

async function fetchUserById(env: Bindings, userId: number) {
	return (await env.DB.prepare("SELECT * FROM users WHERE id = ?")
		.bind(userId)
		.first()) as User | null;
}

async function createUser(
	env: Bindings,
	{
		username,
		phone,
		phoneVerified,
	}: { username: string; phone?: string | null; phoneVerified?: number | null },
) {
	let result: D1Result;
	if (phone !== undefined || phoneVerified !== undefined) {
		result = await env.DB.prepare(
			"INSERT INTO users (username, phone, phone_verified) VALUES (?, ?, ?)",
		)
			.bind(username, phone ?? null, phoneVerified ?? null)
			.run();
	} else {
		result = await env.DB.prepare("INSERT INTO users (username) VALUES (?)")
			.bind(username)
			.run();
	}

	const user = await fetchUserById(env, result.meta.last_row_id);
	return { user, result };
}

async function ensureUserPhoneForOtp(
	env: Bindings,
	user: User | null,
	{ username, phone }: { username: string; phone: string },
) {
	if (!user) {
		const { user: createdUser } = await createUser(env, {
			username,
			phone,
			phoneVerified: 0,
		});
		return createdUser;
	}

	await env.DB.prepare(
		"UPDATE users SET phone = ?, phone_verified = 0 WHERE id = ?",
	)
		.bind(phone, user.id)
		.run();
	return user;
}

async function sendOtpResponse(
	c: { env: Bindings; json: (body: unknown, status?: number) => Response },
	{ phone, username }: { phone: string; username: string },
) {
	const result = await sendOtp(c.env, { phone, username });
	if (!result.success) {
		return c.json({ error: "Unable to send verification code" }, 400);
	}
	return c.json({ status: "code_sent" });
}

// ============ API Routes ============

app.post("/api/auth/start", async (c) => {
	const { username, phone } = await c.req.json();
	const trimmedUsername = normalizeUsername(username);
	const trimmedPhone = String(phone || "").trim();

	const usernameError = validateUsername(trimmedUsername);
	if (usernameError) {
		return c.json({ error: usernameError }, 400);
	}

	let user = await fetchUserByUsername(c.env, trimmedUsername);

	const phoneAuthEnabled = await getPhoneAuthEnabled(c.env);
	if (!phoneAuthEnabled) {
		if (!user) {
			const { user: createdUser } = await createUser(c.env, {
				username: trimmedUsername,
				phone: trimmedPhone || null,
				phoneVerified: 0,
			});
			user = createdUser;
		} else if (trimmedPhone && trimmedPhone !== user.phone) {
			await c.env.DB.prepare("UPDATE users SET phone = ? WHERE id = ?")
				.bind(trimmedPhone, user.id)
				.run();
		}

		if (!user) {
			return c.json({ error: "User not found" }, 404);
		}

		const sessionToken = await createSession(c.env, user);
		return c.json({
			status: "authenticated",
			user: authUserPayload(user),
			token: sessionToken,
		});
	}

	if (user?.phone) {
		return sendOtpResponse(c, {
			phone: user.phone,
			username: trimmedUsername,
		});
	}

	if (!trimmedPhone) {
		return c.json({ status: "needs_phone" });
	}

	user = await ensureUserPhoneForOtp(c.env, user, {
		username: trimmedUsername,
		phone: trimmedPhone,
	});

	return sendOtpResponse(c, {
		phone: trimmedPhone,
		username: trimmedUsername,
	});
});

app.post("/api/auth/verify", async (c) => {
	const { username, otp } = await c.req.json();
	const trimmedUsername = String(username || "").trim();
	const trimmedOtp = String(otp || "").trim();

	if (!trimmedUsername || !trimmedOtp) {
		return c.json({ error: "Missing verification code" }, 400);
	}

	const user = await fetchUserByUsername(c.env, trimmedUsername);

	if (!user) {
		return c.json({ error: "User not found" }, 404);
	}

	const phoneAuthEnabled = await getPhoneAuthEnabled(c.env);
	if (!phoneAuthEnabled) {
		const sessionToken = await createSession(c.env, user);
		return c.json({
			user: authUserPayload(user),
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

	await c.env.DB.prepare("UPDATE users SET phone_verified = 1 WHERE id = ?")
		.bind(user.id)
		.run();
	const sessionToken = await createSession(c.env, user);

	return c.json({
		user: authUserPayload(user),
		token: sessionToken,
	});
});

app.get("/api/auth/session", async (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	return c.json({
		user: authUserPayload(user),
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
	await c.env.OY2.delete(`${SESSION_KV_PREFIX}${sessionToken}`);

	return c.json({ success: true });
});

// Create or get user
app.post("/api/users", async (c) => {
	const { username } = await c.req.json();
	const trimmedUsername = normalizeUsername(username);

	const usernameError = validateUsername(trimmedUsername);
	if (usernameError) {
		return c.json({ error: usernameError }, 400);
	}

	// Check if user exists
	let user = await fetchUserByUsername(c.env, trimmedUsername);

	if (!user) {
		try {
			const { user: createdUser, result } = await createUser(c.env, {
				username: trimmedUsername,
			});
			if (!result.success) {
				return c.json({ error: "Username already taken" }, 400);
			}
			user = createdUser;
		} catch (_err) {
			return c.json({ error: "Username already taken" }, 400);
		}
	}

	return c.json({ user });
});

// Search users
app.get("/api/users/search", async (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Not authenticated" }, 401);
	}
	const q = c.req.query("q");
	const trimmedQuery = q?.trim() ?? "";

	if (trimmedQuery.length < 2) {
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

app.get("/api/users/suggested", async (c) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const suggestions = await c.env.DB.prepare(
		`
    WITH current_friends AS (
      SELECT friend_id
      FROM friendships
      WHERE user_id = ?
    ),
    mutual_counts AS (
      SELECT f.user_id AS candidate_id, COUNT(*) AS mutuals
      FROM friendships f
      INNER JOIN current_friends cf ON cf.friend_id = f.friend_id
      WHERE f.user_id != ?
      GROUP BY f.user_id
    )
    SELECT u.id, u.username, mutual_counts.mutuals
    FROM mutual_counts
    INNER JOIN users u ON u.id = mutual_counts.candidate_id
    WHERE mutual_counts.mutuals > 0
      AND u.id NOT IN (SELECT friend_id FROM current_friends)
      AND u.id != ?
    ORDER BY mutual_counts.mutuals DESC, u.username
    LIMIT 8
  `,
	)
		.bind(user.id, user.id, user.id)
		.all();

	const suggestionResults = (suggestions.results || []) as FriendUser[];
	return c.json({ users: suggestionResults });
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

	const notificationPayload: PushPayload = {
		title: "Oy!",
		body: `${user.username} sent you an Oy!`,
		icon: "/icon-192.png",
		badge: "/icon-192.png",
		type: "oy",
	};
	const { yoId, notificationId, deliveryPayload, subscriptions } =
		await createYoAndNotification({
			env: c.env,
			fromUserId: user.id,
			toUserId,
			type: "oy",
			yoPayload: null,
			makeNotificationPayload: () => ({
				...notificationPayload,
			}),
		});

	c.executionCtx.waitUntil(
		sendPushNotifications({
			env: c.env,
			subscriptions,
			payload: deliveryPayload,
			notificationId,
			toUserId,
		}),
	);

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
    SELECT *
    FROM (
      SELECT y.id, y.from_user_id, y.to_user_id, y.type, y.payload, y.created_at,
             u_from.username as from_username,
             u_to.username as to_username
      FROM yos y
      INNER JOIN users u_from ON y.from_user_id = u_from.id
      INNER JOIN users u_to ON y.to_user_id = u_to.id
      WHERE y.to_user_id = ?
        AND (
          ? = 0
          OR y.created_at < ?
          OR (y.created_at = ? AND y.id < ?)
        )
      UNION ALL
      SELECT y.id, y.from_user_id, y.to_user_id, y.type, y.payload, y.created_at,
             u_from.username as from_username,
             u_to.username as to_username
      FROM yos y
      INNER JOIN users u_from ON y.from_user_id = u_from.id
      INNER JOIN users u_to ON y.to_user_id = u_to.id
      WHERE y.from_user_id = ?
        AND y.to_user_id != ?
        AND (
          ? = 0
          OR y.created_at < ?
          OR (y.created_at = ? AND y.id < ?)
        )
    )
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `,
	)
		.bind(
			user.id,
			hasCursor ? 1 : 0,
			hasCursor ? before : 0,
			hasCursor ? before : 0,
			hasCursor ? beforeId : 0,
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

	const notificationPayload: PushPayload = {
		title: "Lo!",
		body: `${user.username} shared a location`,
		icon: "/icon-192.png",
		badge: "/icon-192.png",
		type: "lo",
	};
	const { yoId, notificationId, deliveryPayload, subscriptions } =
		await createYoAndNotification({
			env: c.env,
			fromUserId: user.id,
			toUserId,
			type: "lo",
			yoPayload: payload,
			makeNotificationPayload: (yoIdValue) => ({
				...notificationPayload,
				url: `/?tab=oys&yo=${yoIdValue}&expand=location`,
			}),
		});

	c.executionCtx.waitUntil(
		sendPushNotifications({
			env: c.env,
			subscriptions,
			payload: deliveryPayload,
			notificationId,
			toUserId,
		}),
	);

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

	await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
		.bind(endpoint)
		.run();

	await c.env.DB.prepare(
		`
      INSERT OR REPLACE INTO push_subscriptions
        (user_id, endpoint, keys_p256dh, keys_auth)
      VALUES (?, ?, ?, ?)
    `,
	)
		.bind(user.id, endpoint, keys.p256dh, keys.auth)
		.run();
	await invalidatePushSubscriptionsCache(c.env, user.id);

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
	await invalidatePushSubscriptionsCache(c.env, user.id);

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

	const [
		activeUsersQuery,
		notificationsQuery,
		deliveriesQuery,
		usersCountQuery,
		subscriptionsCountQuery,
	] = await c.env.DB.batch([
		c.env.DB.prepare(
			`
      SELECT id, username, last_seen
      FROM users
      WHERE last_seen >= ?
        AND EXISTS (
          SELECT 1 FROM sessions WHERE sessions.user_id = users.id
        )
      ORDER BY last_seen DESC
    `,
		).bind(since),
		c.env.DB.prepare(
			"SELECT COUNT(*) as count FROM notifications WHERE created_at >= ?",
		).bind(since),
		c.env.DB.prepare(
			`
      SELECT
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
        COUNT(*) as total_count
      FROM notification_deliveries
      WHERE created_at >= ?
    `,
		).bind(since),
		c.env.DB.prepare("SELECT COUNT(*) as count FROM users"),
		c.env.DB.prepare("SELECT COUNT(*) as count FROM push_subscriptions"),
	]);

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
