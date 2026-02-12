import {
	computeStreakLength,
	createOyAndNotification,
	getStreakDateBoundaries,
	sendPushNotifications,
	updateLastSeen,
} from "../lib";
import type {
	App,
	AppContext,
	OyRow,
	OysCursor,
	PushPayload,
	User,
} from "../types";

type GeocodeResult = {
	addressComponents?: {
		longText: string;
		types: string[];
	}[];
};

type GeocodeResponse = {
	results?: GeocodeResult[];
};

const cityTypes = new Set(["locality", "postal_town", "sublocality"]);

async function reverseGeocodeCity(
	c: AppContext,
	lat: number,
	lon: number,
): Promise<string | null> {
	const response = await fetch(
		`https://geocode.googleapis.com/v4beta/geocode/location?location.latitude=${lat}&location.longitude=${lon}`,
		{
			headers: {
				"Content-Type": "application/json",
				"X-Goog-Api-Key": c.env.GOOGLE_MAPS_API_KEY,
				"X-Goog-FieldMask": "results.addressComponents",
			},
		},
	);

	if (!response.ok) {
		console.warn("Reverse geocode failed:", response.status);
		return null;
	}

	const data = (await response.json()) as GeocodeResponse;
	for (const result of data.results ?? []) {
		for (const component of result.addressComponents ?? []) {
			if (component.types.some((type) => cityTypes.has(type))) {
				return component.longText;
			}
		}
	}
	return null;
}

export function registerOyRoutes(app: App) {
	const sendOyLike = async (
		c: AppContext,
		user: User,
		{
			toUserId,
			type,
			payload,
			makeNotificationPayload,
		}: {
			toUserId: number;
			type: "oy" | "lo";
			payload: string | null;
			makeNotificationPayload: (oyId: number) => PushPayload;
		},
	) => {
		const blockCheckResult = await c.get("db").query(
			`
					SELECT 1
					FROM user_blocks
					WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
						OR (blocker_user_id = $2 AND blocked_user_id = $1)
					LIMIT 1
				`,
			[user.id, toUserId],
		);
		if (blockCheckResult.rows[0]) {
			return c.json({ error: "Cannot send to this user" }, 403);
		}

		const areFriendsResult = await c
			.get("db")
			.query(
				"SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2 LIMIT 1",
				[user.id, toUserId],
			);
		const areFriends = areFriendsResult.rows[0] ?? null;

		if (!areFriends) {
			return c.json(
				{
					error:
						type === "oy"
							? "You can only send Oys to friends"
							: "You can only send Los to friends",
				},
				403,
			);
		}

		const { oyId, notificationId, deliveryPayload, subscriptions } =
			await createOyAndNotification(
				c,
				user.id,
				toUserId,
				type,
				payload,
				makeNotificationPayload,
			);

		const streakResult = await c.get("db").query<{
			last_oy_created_at: number | null;
			streak_start_date: number | null;
		}>(
			"SELECT last_oy_created_at, streak_start_date FROM last_oy_info WHERE user_id = $1 AND friend_id = $2 LIMIT 1",
			[user.id, toUserId],
		);
		const streakRow = (streakResult.rows[0] ?? null) as {
			last_oy_created_at: number | null;
			streak_start_date: number | null;
		} | null;

		const { startOfTodayNY, startOfYesterdayNY } = getStreakDateBoundaries();
		const streak = computeStreakLength({
			lastOyCreatedAt: streakRow?.last_oy_created_at ?? null,
			streakStartDate: streakRow?.streak_start_date ?? null,
			startOfTodayNY,
			startOfYesterdayNY,
		});

		c.executionCtx.waitUntil(
			sendPushNotifications(
				c,
				subscriptions,
				deliveryPayload,
				notificationId,
				toUserId,
			),
		);

		updateLastSeen(c, user.id);
		return c.json({ success: true, yoId: oyId, streak });
	};

	app.post("/api/oy", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const { toUserId } = await c.req.json();

		if (!toUserId) {
			return c.json({ error: "Missing toUserId" }, 400);
		}

		const notificationPayload: PushPayload = {
			title: "Oy!",
			body: `${user.username} sent you an Oy!`,
			icon: "/icon-192.png",
			badge: "/icon-192.png",
			type: "oy",
		};

		return sendOyLike(c, user, {
			toUserId,
			type: "oy",
			payload: null,
			makeNotificationPayload: () => ({ ...notificationPayload }),
		});
	});

	app.post("/api/lo", async (c: AppContext) => {
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

		const city = await reverseGeocodeCity(c, lat, lon);
		const payload = JSON.stringify({
			lat,
			lon,
			accuracy: location.accuracy || null,
			city,
		});

		const notificationPayload: PushPayload = {
			title: "Lo!",
			body: `${user.username} shared a location`,
			icon: "/icon-192.png",
			badge: "/icon-192.png",
			type: "lo",
		};

		return sendOyLike(c, user, {
			toUserId,
			type: "lo",
			payload,
			makeNotificationPayload: (oyIdValue) => ({
				...notificationPayload,
				url: `/?tab=oys&oy=${oyIdValue}&expand=location`,
			}),
		});
	});

	app.get("/api/oys", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const beforeRaw = c.req.query("before");
		const beforeIdRaw = c.req.query("beforeId");
		const noCache = c.req.query("no-cache") === "true";
		const before = beforeRaw ? Number(beforeRaw) : Number.NaN;
		const beforeId = beforeIdRaw ? Number(beforeIdRaw) : Number.NaN;
		const hasCursor = Number.isFinite(before) && Number.isFinite(beforeId);
		const pageSize = 30;

		const db = noCache ? c.get("dbNoCache") : c.get("db");
		const oys = await db.query<{
			id: number;
			from_user_id: number;
			to_user_id: number;
			type: string | null;
			payload: string | null;
			created_at: number;
			from_username: string;
			to_username: string;
			counterpart_nickname: string | null;
		}>(
			`
    WITH inbound AS (
      SELECT y.id, y.from_user_id, y.to_user_id, y.type, y.payload, y.created_at,
             u_from.username as from_username,
             u_to.username as to_username,
             f_self.nickname as counterpart_nickname
      FROM oys y
      INNER JOIN users u_from ON y.from_user_id = u_from.id
      INNER JOIN users u_to ON y.to_user_id = u_to.id
      LEFT JOIN friendships f_self
        ON f_self.user_id = $1 AND f_self.friend_id = y.from_user_id
      WHERE y.to_user_id = $1
        AND NOT EXISTS (
          SELECT 1
          FROM user_blocks b
          WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = y.from_user_id)
            OR (b.blocker_user_id = y.from_user_id AND b.blocked_user_id = $1)
        )
        AND (
          $2 = 0
          OR y.created_at < $3
          OR (y.created_at = $4 AND y.id < $5)
        )
      ORDER BY y.created_at DESC, y.id DESC
      LIMIT $6
    ),
    outbound AS (
      SELECT y.id, y.from_user_id, y.to_user_id, y.type, y.payload, y.created_at,
             u_from.username as from_username,
             u_to.username as to_username,
             f_self.nickname as counterpart_nickname
      FROM oys y
      INNER JOIN users u_from ON y.from_user_id = u_from.id
      INNER JOIN users u_to ON y.to_user_id = u_to.id
      LEFT JOIN friendships f_self
        ON f_self.user_id = $7 AND f_self.friend_id = y.to_user_id
      WHERE y.from_user_id = $7
        AND y.to_user_id != $8
        AND NOT EXISTS (
          SELECT 1
          FROM user_blocks b
          WHERE (b.blocker_user_id = $7 AND b.blocked_user_id = y.to_user_id)
            OR (b.blocker_user_id = y.to_user_id AND b.blocked_user_id = $7)
        )
        AND (
          $9 = 0
          OR y.created_at < $10
          OR (y.created_at = $11 AND y.id < $12)
        )
      ORDER BY y.created_at DESC, y.id DESC
      LIMIT $13
    )
    SELECT *
    FROM (
      SELECT * FROM inbound
      UNION ALL
      SELECT * FROM outbound
    )
    ORDER BY created_at DESC, id DESC
    LIMIT $14
  `,
			[
				user.id,
				hasCursor ? 1 : 0,
				hasCursor ? before : 0,
				hasCursor ? before : 0,
				hasCursor ? beforeId : 0,
				pageSize,
				user.id,
				user.id,
				hasCursor ? 1 : 0,
				hasCursor ? before : 0,
				hasCursor ? before : 0,
				hasCursor ? beforeId : 0,
				pageSize,
				pageSize,
			],
		);

		const results = (oys.rows as OyRow[]).map((oy) => ({
			...oy,
			payload: oy.payload ? JSON.parse(oy.payload) : null,
			type: oy.type || "oy",
		}));

		const hasMore = results.length === pageSize;
		const last = results.at(-1);
		const nextCursor: OysCursor | null =
			hasMore && last ? { before: last.created_at, beforeId: last.id } : null;

		return c.json({ oys: results, nextCursor });
	});
}
