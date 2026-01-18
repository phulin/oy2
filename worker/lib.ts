import { sendPushNotification } from "./push";
import type { Bindings, PushPayload, PushSubscriptionRow, User } from "./types";

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

export async function getPhoneAuthEnabled(env: Bindings) {
	const stored = await env.OY2.get(PHONE_AUTH_KV_KEY);
	if (stored === null) {
		return true;
	}
	return stored === "true";
}

export async function setPhoneAuthEnabled(env: Bindings, enabled: boolean) {
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

export async function sendPushNotifications({
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

export async function createYoAndNotification({
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

export async function invalidatePushSubscriptionsCache(
	env: Bindings,
	userId: number,
) {
	await env.OY2.delete(pushSubscriptionsCacheKey(userId));
}

export async function sendOtp(
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

export async function verifyOtp(
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

export async function createSession(env: Bindings, user: User) {
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

export async function fetchUserByUsername(env: Bindings, username: string) {
	return (await env.DB.prepare(
		"SELECT * FROM users WHERE username COLLATE NOCASE = ?",
	)
		.bind(username)
		.first()) as User | null;
}

export async function fetchUserById(env: Bindings, userId: number) {
	return (await env.DB.prepare("SELECT * FROM users WHERE id = ?")
		.bind(userId)
		.first()) as User | null;
}

export async function createUser(
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

export async function ensureUserPhoneForOtp(
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

export async function sendOtpResponse(
	c: { env: Bindings; json: (body: unknown, status?: number) => Response },
	{ phone, username }: { phone: string; username: string },
) {
	const result = await sendOtp(c.env, { phone, username });
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
