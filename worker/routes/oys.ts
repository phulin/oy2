import {
	computeStreakLength,
	createYoAndNotification,
	getStreakDateBoundaries,
	sendPushNotifications,
	updateLastSeen,
} from "../lib";
import type {
	App,
	AppContext,
	YoRow as OyRow,
	OysCursor,
	PushPayload,
} from "../types";

export function registerOyRoutes(app: App) {
	app.post("/api/oy", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const { toUserId } = await c.req.json();

		if (!toUserId) {
			return c.json({ error: "Missing toUserId" }, 400);
		}

		const areFriendsResult = await c
			.get("db")
			.query(
				"SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2 LIMIT 1",
				[user.id, toUserId],
			);
		const areFriends = areFriendsResult.rows[0] ?? null;

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
			await createYoAndNotification(c, user.id, toUserId, "oy", null, () => ({
				...notificationPayload,
			}));

		const streakResult = await c.get("db").query<{
			last_yo_created_at: number | null;
			streak_start_date: number | null;
		}>(
			"SELECT last_yo_created_at, streak_start_date FROM last_yo_info WHERE user_id = $1 AND friend_id = $2 LIMIT 1",
			[user.id, toUserId],
		);
		const streakRow = (streakResult.rows[0] ?? null) as {
			last_yo_created_at: number | null;
			streak_start_date: number | null;
		} | null;

		const { startOfTodayNY, startOfYesterdayNY } = getStreakDateBoundaries();
		const streak = computeStreakLength({
			lastYoCreatedAt: streakRow?.last_yo_created_at ?? null,
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
		return c.json({ success: true, yoId, streak });
	});

	app.get("/api/oys", async (c: AppContext) => {
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

		const oys = await c.get("db").query<{
			id: number;
			from_user_id: number;
			to_user_id: number;
			type: string | null;
			payload: string | null;
			created_at: number;
			from_username: string;
			to_username: string;
		}>(
			`
    WITH inbound AS (
      SELECT y.id, y.from_user_id, y.to_user_id, y.type, y.payload, y.created_at,
             u_from.username as from_username,
             u_to.username as to_username
      FROM yos y
      INNER JOIN users u_from ON y.from_user_id = u_from.id
      INNER JOIN users u_to ON y.to_user_id = u_to.id
      WHERE y.to_user_id = $1
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
             u_to.username as to_username
      FROM yos y
      INNER JOIN users u_from ON y.from_user_id = u_from.id
      INNER JOIN users u_to ON y.to_user_id = u_to.id
      WHERE y.from_user_id = $7
        AND y.to_user_id != $8
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

		const areFriendsResult = await c
			.get("db")
			.query(
				"SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2 LIMIT 1",
				[user.id, toUserId],
			);
		const areFriends = areFriendsResult.rows[0] ?? null;

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
			await createYoAndNotification(
				c,
				user.id,
				toUserId,
				"lo",
				payload,
				(yoIdValue) => ({
					...notificationPayload,
					url: `/?tab=oys&yo=${yoIdValue}&expand=location`,
				}),
			);

		const streakResult = await c.get("db").query<{
			last_yo_created_at: number | null;
			streak_start_date: number | null;
		}>(
			"SELECT last_yo_created_at, streak_start_date FROM last_yo_info WHERE user_id = $1 AND friend_id = $2 LIMIT 1",
			[user.id, toUserId],
		);
		const streakRow = (streakResult.rows[0] ?? null) as {
			last_yo_created_at: number | null;
			streak_start_date: number | null;
		} | null;

		const { startOfTodayNY, startOfYesterdayNY } = getStreakDateBoundaries();
		const streak = computeStreakLength({
			lastYoCreatedAt: streakRow?.last_yo_created_at ?? null,
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
		return c.json({ success: true, yoId, streak });
	});
}
