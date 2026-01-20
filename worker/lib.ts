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

function getStartOfDayNY(date: Date): number {
	const nyDateStr = date.toLocaleDateString("en-US", {
		timeZone: "America/New_York",
	});
	const [month, day, year] = nyDateStr.split("/").map(Number);
	const nyMidnight = new Date(
		date.toLocaleString("en-US", { timeZone: "America/New_York" }),
	);
	nyMidnight.setFullYear(year, month - 1, day);
	nyMidnight.setHours(0, 0, 0, 0);
	const offset =
		date.getTime() -
		new Date(
			date.toLocaleString("en-US", { timeZone: "America/New_York" }),
		).getTime();
	return Math.floor((nyMidnight.getTime() + offset) / 1000);
}

export function getStreakDateBoundaries(): {
	startOfTodayNY: number;
	startOfYesterdayNY: number;
} {
	const now = new Date();
	const startOfTodayNY = getStartOfDayNY(now);
	const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	const startOfYesterdayNY = getStartOfDayNY(yesterday);
	return { startOfTodayNY, startOfYesterdayNY };
}

const SECONDS_PER_DAY = 24 * 60 * 60;

export function computeStreakLength({
	lastOyCreatedAt,
	streakStartDate,
	startOfTodayNY,
	startOfYesterdayNY,
}: {
	lastOyCreatedAt: number | null;
	streakStartDate: number | null;
	startOfTodayNY: number;
	startOfYesterdayNY: number;
}): number {
	if (lastOyCreatedAt === null || streakStartDate === null) {
		return 0;
	}
	if (lastOyCreatedAt < startOfYesterdayNY) {
		return 0;
	}
	const daysSinceStart = Math.floor(
		(startOfTodayNY - streakStartDate) / SECONDS_PER_DAY,
	);
	const hasOyToday = lastOyCreatedAt >= startOfTodayNY;
	return daysSinceStart + (hasOyToday ? 1 : 0);
}

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
		const queries: Array<Promise<unknown>> = [];

		for (let i = 0; i < results.length; i += 1) {
			const result = results[i];
			const sub = subscriptions[i];

			for (const attempt of result.attempts) {
				queries.push(
					c.get("db").query(
						`
            INSERT INTO notification_deliveries
              (notification_id, endpoint, attempt, success, status_code, error_message)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
						[
							notificationId,
							attempt.endpoint,
							attempt.attempt,
							attempt.success ? 1 : 0,
							attempt.statusCode ?? null,
							attempt.errorMessage ?? null,
						],
					),
				);
			}

			if (!result.delivered) {
				console.error("Failed to send push:", result.statusCode);
				if (result.statusCode === 410) {
					queries.push(
						c
							.get("db")
							.query(
								"DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2",
								[toUserId, sub.endpoint],
							),
					);
					didMutateSubscriptions = true;
				}
			}
		}

		if (queries.length > 0) {
			await Promise.all(queries);
		}
		if (didMutateSubscriptions) {
			await invalidatePushSubscriptionsCache(c, toUserId);
		}
	} catch (err) {
		console.error("Push notification error:", err);
	}
}

export async function createOyAndNotification(
	c: AppContext,
	fromUserId: number,
	toUserId: number,
	type: "oy" | "lo",
	oyPayload: string | null,
	makeNotificationPayload: (oyId: number) => PushPayload,
) {
	const createdAt = Math.floor(Date.now() / 1000);
	const { startOfTodayNY, startOfYesterdayNY } = getStreakDateBoundaries();
	const oyResult = await c.get("db").query<{ id: number }>(
		`
      INSERT INTO oys (from_user_id, to_user_id, type, payload, created_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `,
		[fromUserId, toUserId, type, oyPayload, createdAt],
	);

	const oyId = Number(oyResult.rows[0]?.id);

	// Update last_oy_info for both directions of the friendship
	await c.get("db").query(
		`
      INSERT INTO last_oy_info (user_id, friend_id, last_oy_id, last_oy_type, last_oy_created_at, last_oy_from_user_id, streak_start_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, friend_id) DO UPDATE SET
        last_oy_id = EXCLUDED.last_oy_id,
        last_oy_type = EXCLUDED.last_oy_type,
        last_oy_created_at = EXCLUDED.last_oy_created_at,
        last_oy_from_user_id = EXCLUDED.last_oy_from_user_id,
        streak_start_date = CASE
          WHEN last_oy_info.last_oy_created_at >= $8 THEN last_oy_info.streak_start_date
          ELSE EXCLUDED.streak_start_date
        END
    `,
		[
			fromUserId,
			toUserId,
			oyId,
			type,
			createdAt,
			fromUserId,
			startOfTodayNY,
			startOfYesterdayNY,
		],
	);

	await c.get("db").query(
		`
      INSERT INTO last_oy_info (user_id, friend_id, last_oy_id, last_oy_type, last_oy_created_at, last_oy_from_user_id, streak_start_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, friend_id) DO UPDATE SET
        last_oy_id = EXCLUDED.last_oy_id,
        last_oy_type = EXCLUDED.last_oy_type,
        last_oy_created_at = EXCLUDED.last_oy_created_at,
        last_oy_from_user_id = EXCLUDED.last_oy_from_user_id,
        streak_start_date = CASE
          WHEN last_oy_info.last_oy_created_at >= $8 THEN last_oy_info.streak_start_date
          ELSE EXCLUDED.streak_start_date
        END
    `,
		[
			toUserId,
			fromUserId,
			oyId,
			type,
			createdAt,
			fromUserId,
			startOfTodayNY,
			startOfYesterdayNY,
		],
	);

	const notificationPayload: PushPayload = {
		...makeNotificationPayload(oyId),
		createdAt,
		fromUserId,
	};
	const subscriptionsPromise = fetchPushSubscriptions(c, toUserId);
	const notificationInsertPromise = c.get("db").query<{ id: number }>(
		`
      INSERT INTO notifications (to_user_id, from_user_id, type, payload)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `,
		[toUserId, fromUserId, type, JSON.stringify(notificationPayload)],
	);
	const [notificationInsert, subscriptions] = await Promise.all([
		notificationInsertPromise,
		subscriptionsPromise,
	]);
	const notificationId = Number(notificationInsert.rows[0]?.id);

	const deliveryPayload: PushPayload = {
		...notificationPayload,
		notificationId,
		tag: `notification-${notificationId}`,
	};

	return {
		oyId,
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

	const subscriptionResults = await c.get("db").query<PushSubscriptionRow>(
		`
      SELECT endpoint, keys_p256dh, keys_auth
      FROM push_subscriptions
      WHERE user_id = $1
    `,
		[userId],
	);

	const subscriptions = subscriptionResults.rows;
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
	await c
		.get("db")
		.query("INSERT INTO sessions (token, user_id) VALUES ($1, $2)", [
			sessionToken,
			user.id,
		]);
	await c.env.OY2.put(
		`${SESSION_KV_PREFIX}${sessionToken}`,
		JSON.stringify(user),
	);
	return sessionToken;
}

export function updateLastSeen(c: AppContext, userId: number) {
	const now = Math.floor(Date.now() / 1000);
	c.executionCtx.waitUntil(
		c.get("db").query(
			`INSERT INTO user_last_seen (user_id, last_seen) VALUES ($1, $2)
				ON CONFLICT (user_id) DO UPDATE SET last_seen = EXCLUDED.last_seen`,
			[userId, now],
		),
	);
}

export async function fetchUserByUsername(c: AppContext, username: string) {
	const result = await c
		.get("db")
		.query<User>("SELECT * FROM users WHERE username ILIKE $1", [username]);
	return result.rows[0] ?? null;
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
