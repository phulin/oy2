import { createYoAndNotification, sendPushNotifications } from "../lib";
import type { App, AppContext, OysCursor, PushPayload, YoRow } from "../types";

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
			await createYoAndNotification(c, user.id, toUserId, "oy", null, () => ({
				...notificationPayload,
			}));

		const streakRow = (await c.env.DB.prepare(
			"SELECT streak FROM friendships WHERE user_id = ? AND friend_id = ? LIMIT 1",
		)
			.bind(user.id, toUserId)
			.first()) as { streak: number };

		c.executionCtx.waitUntil(
			sendPushNotifications(
				c,
				subscriptions,
				deliveryPayload,
				notificationId,
				toUserId,
			),
		);

		return c.json({ success: true, yoId, streak: streakRow.streak });
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

		const yos = await c.env.DB.prepare(
			`
    WITH inbound AS (
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
      ORDER BY y.created_at DESC, y.id DESC
      LIMIT ?
    ),
    outbound AS (
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
      ORDER BY y.created_at DESC, y.id DESC
      LIMIT ?
    )
    SELECT *
    FROM (
      SELECT * FROM inbound
      UNION ALL
      SELECT * FROM outbound
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
				pageSize,
				user.id,
				user.id,
				hasCursor ? 1 : 0,
				hasCursor ? before : 0,
				hasCursor ? before : 0,
				hasCursor ? beforeId : 0,
				pageSize,
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

		const streakRow = (await c.env.DB.prepare(
			"SELECT streak FROM friendships WHERE user_id = ? AND friend_id = ? LIMIT 1",
		)
			.bind(user.id, toUserId)
			.first()) as { streak: number };

		c.executionCtx.waitUntil(
			sendPushNotifications(
				c,
				subscriptions,
				deliveryPayload,
				notificationId,
				toUserId,
			),
		);

		return c.json({ success: true, yoId, streak: streakRow.streak });
	});
}
