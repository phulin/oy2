import { sendPushNotification } from "./push";
import type {
	AppContext,
	Bindings,
	PushPayload,
	PushSubscriptionRow,
	User,
} from "./types";

const PUSH_MAX_ATTEMPTS = 3;
const PUSH_BACKOFF_MS = 250;
const PUSH_BACKOFF_MULTIPLIER = 2;
const SETTINGS_KV_PREFIX = "settings:";
export const PHONE_AUTH_KV_KEY = `${SETTINGS_KV_PREFIX}phone_auth_enabled`;
export const SESSION_KV_PREFIX = "session:";
const PUSH_SUBSCRIPTIONS_KV_PREFIX = "push_subscriptions:";

const delay = (ms: number) =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

export async function getPhoneAuthEnabled(c: AppContext) {
	const stored = await c.env.OY2.get(PHONE_AUTH_KV_KEY);
	if (stored === null) {
		return true;
	}
	return stored === "true";
}

export async function setPhoneAuthEnabled(c: AppContext, enabled: boolean) {
	await c.env.OY2.put(PHONE_AUTH_KV_KEY, enabled ? "true" : "false");
}

async function sendPushWithRetry(
	env: Bindings,
	subscription: {
		endpoint: string;
		expirationTime: number | null;
		keys: { p256dh: string; auth: string };
	},
	payload: PushPayload,
) {
	let lastStatusCode: number | undefined;
	const attempts: {
		endpoint: string;
		attempt: number;
		success: boolean;
		statusCode?: number;
		errorMessage?: string;
	}[] = [];
	for (let attempt = 1; attempt <= PUSH_MAX_ATTEMPTS; attempt += 1) {
		try {
			const response = await sendPushNotification(env, subscription, payload);
			attempts.push({
				endpoint: subscription.endpoint,
				attempt,
				success: true,
				statusCode: response.status,
			});
			return { delivered: true, attempts };
		} catch (err) {
			const statusCode = (err as { statusCode?: number }).statusCode;
			lastStatusCode = statusCode;
			const errorMessage = err instanceof Error ? err.message : String(err);
			attempts.push({
				endpoint: subscription.endpoint,
				attempt,
				success: false,
				statusCode,
				errorMessage,
			});
			if (statusCode === 410) {
				return { delivered: false, statusCode, attempts };
			}
			if (attempt < PUSH_MAX_ATTEMPTS) {
				const backoff =
					PUSH_BACKOFF_MS * PUSH_BACKOFF_MULTIPLIER ** (attempt - 1);
				await delay(backoff);
			}
		}
	}

	return { delivered: false, statusCode: lastStatusCode, attempts };
}

export async function sendPushNotifications(
	c: AppContext,
	subscriptions: PushSubscriptionRow[],
	payload: PushPayload,
	notificationId: number,
	toUserId: number,
) {
	try {
		const { env } = c;
		const results = await Promise.all(
			subscriptions.map((sub) => {
				const subscription = {
					endpoint: sub.endpoint,
					expirationTime: null,
					keys: {
						p256dh: sub.keys_p256dh,
						auth: sub.keys_auth,
					},
				};

				return sendPushWithRetry(env, subscription, payload);
			}),
		);

		let didMutateSubscriptions = false;
		const statements: D1PreparedStatement[] = [];

		for (let i = 0; i < results.length; i += 1) {
			const result = results[i];
			const sub = subscriptions[i];

			for (const attempt of result.attempts) {
				statements.push(
					env.DB.prepare(
						`
            INSERT INTO notification_deliveries
              (notification_id, endpoint, attempt, success, status_code, error_message)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
					).bind(
						notificationId,
						attempt.endpoint,
						attempt.attempt,
						attempt.success ? 1 : 0,
						attempt.statusCode ?? null,
						attempt.errorMessage ?? null,
					),
				);
			}

			if (!result.delivered) {
				console.error("Failed to send push:", result.statusCode);
				if (result.statusCode === 410) {
					statements.push(
						env.DB.prepare(
							"DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
						).bind(toUserId, sub.endpoint),
					);
					didMutateSubscriptions = true;
				}
			}
		}

		if (statements.length > 0) {
			await env.DB.batch(statements);
		}
		if (didMutateSubscriptions) {
			await invalidatePushSubscriptionsCache(c, toUserId);
		}
	} catch (err) {
		console.error("Push notification error:", err);
	}
}

export async function createYoAndNotification(
	c: AppContext,
	fromUserId: number,
	toUserId: number,
	type: "oy" | "lo",
	yoPayload: string | null,
	makeNotificationPayload: (yoId: number) => PushPayload,
) {
	const { env } = c;
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
	const subscriptionsPromise = fetchPushSubscriptions(c, toUserId);
	const notificationInsertPromise = env.DB.prepare(
		`
      INSERT INTO notifications (to_user_id, from_user_id, type, payload)
      VALUES (?, ?, ?, ?)
    `,
	)
		.bind(toUserId, fromUserId, type, JSON.stringify(notificationPayload))
		.run();
	const [notificationInsert, subscriptions] = await Promise.all([
		notificationInsertPromise,
		subscriptionsPromise,
	]);
	const notificationId = Number(notificationInsert.meta.last_row_id);

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

async function fetchPushSubscriptions(c: AppContext, userId: number) {
	const cacheKey = pushSubscriptionsCacheKey(userId);
	const cached = await c.env.OY2.get(cacheKey, "json");
	if (cached) {
		return cached as PushSubscriptionRow[];
	}

	const subscriptionResults = await c.env.DB.prepare(
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
	const cacheWrite = c.env.OY2.put(cacheKey, JSON.stringify(subscriptions));
	c.executionCtx.waitUntil(cacheWrite);
	return subscriptions;
}

export async function invalidatePushSubscriptionsCache(
	c: AppContext,
	userId: number,
) {
	await c.env.OY2.delete(pushSubscriptionsCacheKey(userId));
}

export async function sendOtp(
	c: AppContext,
	{ phone, username }: { phone: string; username: string },
) {
	const response = await fetch("https://textbelt.com/otp/generate", {
		method: "POST",
		body: new URLSearchParams({
			phone,
			userid: username,
			key: c.env.TEXTBELT_API_KEY,
			message: "Your Oy verification code is $OTP",
		}),
	});
	return response.json() as Promise<{
		success: boolean;
		quotaRemaining: number;
		otp: string;
	}>;
}

export async function verifyOtp(
	c: AppContext,
	{ otp, username }: { otp: string; username: string },
) {
	const params = new URLSearchParams({
		otp,
		userid: username,
		key: c.env.TEXTBELT_API_KEY,
	});
	const response = await fetch(
		`https://textbelt.com/otp/verify?${params.toString()}`,
	);
	return response.json() as Promise<{ success: boolean; isValidOtp: boolean }>;
}

export function authUserPayload(user: User) {
	return {
		id: user.id,
		username: user.username,
		...(user.admin ? { admin: true } : {}),
	};
}

export function normalizeUsername(username: unknown) {
	return String(username || "").trim();
}

export function validateUsername(username: string) {
	if (!username || username.length < 2 || username.length > 20) {
		return "Username must be 2-20 characters";
	}
	return null;
}

export async function createSession(c: AppContext, user: User) {
	const sessionToken = crypto.randomUUID();
	await c.env.DB.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)")
		.bind(sessionToken, user.id)
		.run();
	await c.env.OY2.put(
		`${SESSION_KV_PREFIX}${sessionToken}`,
		JSON.stringify(user),
	);
	return sessionToken;
}

export async function fetchUserByUsername(c: AppContext, username: string) {
	return (await c.env.DB.prepare(
		"SELECT * FROM users WHERE username COLLATE NOCASE = ?",
	)
		.bind(username)
		.first()) as User | null;
}

export async function fetchUserById(c: AppContext, userId: number) {
	return (await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
		.bind(userId)
		.first()) as User | null;
}

export async function createUser(
	c: AppContext,
	{
		username,
		phone,
		phoneVerified,
	}: { username: string; phone?: string | null; phoneVerified?: number | null },
) {
	let result: D1Result;
	if (phone !== undefined || phoneVerified !== undefined) {
		result = await c.env.DB.prepare(
			"INSERT INTO users (username, phone, phone_verified) VALUES (?, ?, ?)",
		)
			.bind(username, phone ?? null, phoneVerified ?? null)
			.run();
	} else {
		result = await c.env.DB.prepare("INSERT INTO users (username) VALUES (?)")
			.bind(username)
			.run();
	}

	const user = await fetchUserById(c, result.meta.last_row_id);
	return { user, result };
}

export async function ensureUserPhoneForOtp(
	c: AppContext,
	user: User | null,
	{ username, phone }: { username: string; phone: string },
) {
	if (!user) {
		const { user: createdUser } = await createUser(c, {
			username,
			phone,
			phoneVerified: 0,
		});
		return createdUser;
	}

	await c.env.DB.prepare(
		"UPDATE users SET phone = ?, phone_verified = 0 WHERE id = ?",
	)
		.bind(phone, user.id)
		.run();
	return user;
}

export async function sendOtpResponse(
	c: AppContext,
	{ phone, username }: { phone: string; username: string },
) {
	const result = await sendOtp(c, { phone, username });
	if (!result.success) {
		return c.json({ error: "Unable to send verification code" }, 400);
	}
	return c.json({ status: "code_sent" });
}

export function requireAdmin(c: { get: (key: "user") => User | null }) {
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
