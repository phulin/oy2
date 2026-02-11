import { sendNativePushNotification, sendPushNotification } from "./push";
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

type PushAttempt = {
	endpoint: string;
	attempt: number;
	success: boolean;
	statusCode?: number;
	errorMessage?: string;
};

type PushSendResult = {
	delivered: boolean;
	statusCode?: number;
	permanentFailure: boolean;
	attempts: PushAttempt[];
};

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

async function sendSinglePush(
	env: Bindings,
	subscription: PushSubscriptionRow,
	payload: PushPayload,
	options?: { requestUrl?: string },
) {
	if (subscription.platform === "web") {
		return sendPushNotification(
			env,
			{
				endpoint: subscription.endpoint as string,
				expirationTime: null,
				keys: {
					p256dh: subscription.keys_p256dh as string,
					auth: subscription.keys_auth as string,
				},
			},
			payload,
		);
	}
	return sendNativePushNotification(
		env,
		subscription.platform,
		subscription.native_token as string,
		payload,
		{
			requestUrl: options?.requestUrl,
			apnsEnvironment: subscription.apns_environment ?? undefined,
		},
	);
}

async function sendPushWithRetry(
	env: Bindings,
	subscription: PushSubscriptionRow,
	payload: PushPayload,
	options?: { requestUrl?: string },
): Promise<PushSendResult> {
	let lastStatusCode: number | undefined;
	let permanentFailure = false;
	const identifier =
		subscription.platform === "web"
			? subscription.endpoint
			: subscription.native_token;
	if (!identifier) {
		return {
			delivered: false,
			statusCode: undefined,
			permanentFailure: true,
			attempts: [],
		};
	}

	const attempts: PushAttempt[] = [];
	for (let attempt = 1; attempt <= PUSH_MAX_ATTEMPTS; attempt += 1) {
		try {
			const response = await sendSinglePush(
				env,
				subscription,
				payload,
				options,
			);
			attempts.push({
				endpoint: identifier,
				attempt,
				success: true,
				statusCode: response.status,
			});
			return { delivered: true, permanentFailure: false, attempts };
		} catch (err) {
			const statusCode = (err as { statusCode?: number }).statusCode;
			permanentFailure = Boolean((err as { permanent?: boolean }).permanent);
			lastStatusCode = statusCode;
			const errorMessage = err instanceof Error ? err.message : String(err);
			attempts.push({
				endpoint: identifier,
				attempt,
				success: false,
				statusCode,
				errorMessage,
			});
			if (permanentFailure) {
				return { delivered: false, statusCode, permanentFailure, attempts };
			}
			if (attempt < PUSH_MAX_ATTEMPTS) {
				const backoff =
					PUSH_BACKOFF_MS * PUSH_BACKOFF_MULTIPLIER ** (attempt - 1);
				await delay(backoff);
			}
		}
	}

	return {
		delivered: false,
		statusCode: lastStatusCode,
		permanentFailure,
		attempts,
	};
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
			subscriptions.map((sub) =>
				sendPushWithRetry(env, sub, payload, { requestUrl: c.req.url }),
			),
		);

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
				const lastAttempt = result.attempts[result.attempts.length - 1];
				console.error("Failed to send push", {
					platform: sub.platform,
					target: sub.platform === "web" ? sub.endpoint : sub.native_token,
					statusCode: result.statusCode ?? null,
					lastError: lastAttempt?.errorMessage ?? null,
					attempts: result.attempts.length,
				});
				if (result.permanentFailure) {
					if (sub.platform === "web") {
						queries.push(
							c
								.get("db")
								.query(
									"DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2",
									[toUserId, sub.endpoint],
								),
						);
					} else {
						queries.push(
							c
								.get("db")
								.query(
									"DELETE FROM push_subscriptions WHERE user_id = $1 AND native_token = $2",
									[toUserId, sub.native_token],
								),
						);
					}
				}
			}
		}

		if (queries.length > 0) {
			await Promise.all(queries);
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
	const lastOyInfoPromise = c.get("db").query(
		`
      INSERT INTO last_oy_info (user_id, friend_id, last_oy_id, last_oy_type, last_oy_created_at, last_oy_from_user_id, streak_start_date)
      VALUES
        ($1, $2, $3, $4, $5, $1, $6),
        ($2, $1, $3, $4, $5, $1, $6)
      ON CONFLICT (user_id, friend_id) DO UPDATE SET
        last_oy_id = EXCLUDED.last_oy_id,
        last_oy_type = EXCLUDED.last_oy_type,
        last_oy_created_at = EXCLUDED.last_oy_created_at,
        last_oy_from_user_id = EXCLUDED.last_oy_from_user_id,
        streak_start_date = CASE
          WHEN last_oy_info.last_oy_created_at >= $7 THEN last_oy_info.streak_start_date
          ELSE EXCLUDED.streak_start_date
        END
    `,
		[
			fromUserId,
			toUserId,
			oyId,
			type,
			createdAt,
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
	const [, notificationInsert, subscriptions] = await Promise.all([
		lastOyInfoPromise,
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

async function fetchPushSubscriptions(c: AppContext, userId: number) {
	const subscriptionResults = await c
		.get("dbNoCache")
		.query<PushSubscriptionRow>(
			`
      SELECT platform, endpoint, keys_p256dh, keys_auth, native_token, apns_environment
      FROM push_subscriptions
      WHERE user_id = $1
    `,
			[userId],
		);

	return subscriptionResults.rows;
}

export function authUserPayload(user: User) {
	return {
		id: user.id,
		username: user.username,
		email: user.email ?? null,
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

export async function fetchUserByUsername(
	c: AppContext,
	username: string,
): Promise<User | null> {
	const result = await c
		.get("db")
		.query<User>("SELECT * FROM users WHERE username ILIKE $1", [username]);
	return result.rows[0] ?? null;
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
