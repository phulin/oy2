import { computeStreakLength, getStreakDateBoundaries } from "../lib";
import { containsAbusiveText } from "../moderation";
import type {
	App,
	FriendListRow,
	FriendProfileRow,
	LastOyInfoRow,
	User,
} from "../types";

const parseFriendId = (
	friendIdRaw: string | undefined,
	currentUserId: number,
): number | null => {
	const friendId = Number(friendIdRaw);
	if (
		!Number.isInteger(friendId) ||
		friendId <= 0 ||
		friendId === currentUserId
	) {
		return null;
	}
	return friendId;
};

export function registerFriendRoutes(app: App) {
	app.post("/api/friends", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const { friendId } = await c.req.json();

		if (!friendId || friendId === user.id) {
			return c.json({ error: "Invalid friend ID" }, 400);
		}

		const friendResult = await c
			.get("db")
			.query<User>("SELECT * FROM users WHERE id = $1", [friendId]);
		const friend = friendResult.rows[0] ?? null;

		if (!friend) {
			return c.json({ error: "User not found" }, 404);
		}

		const blockCheck = await c.get("db").query(
			`
				SELECT 1
				FROM user_blocks
				WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
					OR (blocker_user_id = $2 AND blocked_user_id = $1)
				LIMIT 1
			`,
			[user.id, friendId],
		);
		if (blockCheck.rows[0]) {
			return c.json({ error: "Cannot add this user as a friend" }, 403);
		}

		await Promise.all([
			c
				.get("db")
				.query(
					"INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
					[user.id, friendId],
				),
			c
				.get("db")
				.query(
					"INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
					[friendId, user.id],
				),
		]);

		return c.json({
			friend: {
				id: friend.id,
				username: friend.username,
			},
		});
	});

	app.get("/api/friends", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const noCache = c.req.query("no-cache") === "true";
		const db = noCache ? c.get("dbNoCache") : c.get("db");
		const friends = await db.query<FriendListRow>(
			`
    SELECT
      u.id,
      u.username
    FROM friendships f
    INNER JOIN users u ON u.id = f.friend_id
    LEFT JOIN user_blocks b1
      ON b1.blocker_user_id = f.user_id AND b1.blocked_user_id = f.friend_id
    LEFT JOIN user_blocks b2
      ON b2.blocker_user_id = f.friend_id AND b2.blocked_user_id = f.user_id
    WHERE f.user_id = $1
      AND b1.blocker_user_id IS NULL
      AND b2.blocker_user_id IS NULL
    ORDER BY u.username
  `,
			[user.id],
		);

		const friendResults = friends.rows.map((row) => ({
			id: row.id,
			username: row.username,
		}));
		return c.json({ friends: friendResults });
	});

	app.get("/api/last-oy-info", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const noCache = c.req.query("no-cache") === "true";
		const db = noCache ? c.get("dbNoCache") : c.get("db");
		const lastOyInfo = await db.query<LastOyInfoRow>(
			`
    SELECT
      friend_id,
      last_oy_type,
      last_oy_created_at,
      last_oy_from_user_id,
      streak_start_date
    FROM last_oy_info
    WHERE user_id = $1
  `,
			[user.id],
		);

		const { startOfTodayNY, startOfYesterdayNY } = getStreakDateBoundaries();
		const results = lastOyInfo.rows.map((info) => {
			const streak = computeStreakLength({
				lastOyCreatedAt: info.last_oy_created_at,
				streakStartDate: info.streak_start_date,
				startOfTodayNY,
				startOfYesterdayNY,
			});
			return {
				friend_id: info.friend_id,
				last_oy_type: info.last_oy_type,
				last_oy_created_at: info.last_oy_created_at,
				last_oy_from_user_id: info.last_oy_from_user_id,
				streak,
			};
		});
		return c.json({ lastOyInfo: results });
	});

	app.get("/api/friends/profiles", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}
		const { startOfTodayNY, startOfYesterdayNY } = getStreakDateBoundaries();

		const profilesResult = await c.get("db").query<FriendProfileRow>(
			`
				SELECT
					u.id,
					u.username,
					(
						SELECT COUNT(*)
						FROM friendships f_count
						WHERE f_count.user_id = u.id
					)::INTEGER AS friend_count,
					(
						SELECT COUNT(*)
						FROM oys sent
						WHERE sent.from_user_id = u.id
					)::INTEGER AS lifetime_oys_sent,
					(
						SELECT COUNT(*)
						FROM oys received
						WHERE received.to_user_id = u.id
					)::INTEGER AS lifetime_oys_received,
					loi.last_oy_type,
					loi.last_oy_created_at,
					loi.last_oy_from_user_id,
					loi.streak_start_date
				FROM friendships f
				INNER JOIN users u ON u.id = f.friend_id
				LEFT JOIN last_oy_info loi
					ON loi.user_id = f.user_id AND loi.friend_id = f.friend_id
				LEFT JOIN user_blocks b1
					ON b1.blocker_user_id = f.user_id AND b1.blocked_user_id = f.friend_id
				LEFT JOIN user_blocks b2
					ON b2.blocker_user_id = f.friend_id AND b2.blocked_user_id = f.user_id
				WHERE f.user_id = $1
					AND b1.blocker_user_id IS NULL
					AND b2.blocker_user_id IS NULL
				ORDER BY loi.last_oy_created_at DESC NULLS LAST, u.username
			`,
			[user.id],
		);

		return c.json({
			profiles: profilesResult.rows.map((row) => ({
				id: row.id,
				username: row.username,
				friendCount: Number(row.friend_count),
				lifetimeOysSent: Number(row.lifetime_oys_sent),
				lifetimeOysReceived: Number(row.lifetime_oys_received),
				lastOyType: row.last_oy_type,
				lastOyCreatedAt: row.last_oy_created_at,
				lastOyFromUserId: row.last_oy_from_user_id,
				streak: computeStreakLength({
					lastOyCreatedAt: row.last_oy_created_at,
					streakStartDate: row.streak_start_date,
					startOfTodayNY,
					startOfYesterdayNY,
				}),
			})),
		});
	});

	app.delete("/api/friends/:friendId", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const friendId = parseFriendId(c.req.param("friendId"), user.id);
		if (friendId === null) {
			return c.json({ error: "Invalid friend ID" }, 400);
		}

		await Promise.all([
			c
				.get("db")
				.query(
					"DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)",
					[user.id, friendId],
				),
			c
				.get("db")
				.query(
					"DELETE FROM last_oy_info WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)",
					[user.id, friendId],
				),
		]);

		return c.json({ success: true });
	});

	app.post("/api/friends/:friendId/block", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const friendId = parseFriendId(c.req.param("friendId"), user.id);
		if (friendId === null) {
			return c.json({ error: "Invalid friend ID" }, 400);
		}

		const targetUserResult = await c
			.get("db")
			.query<User>("SELECT id, username FROM users WHERE id = $1", [friendId]);
		if (!targetUserResult.rows[0]) {
			return c.json({ error: "User not found" }, 404);
		}

		await Promise.all([
			c
				.get("db")
				.query(
					"INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
					[user.id, friendId],
				),
			c
				.get("db")
				.query(
					"DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)",
					[user.id, friendId],
				),
			c
				.get("db")
				.query(
					"DELETE FROM last_oy_info WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)",
					[user.id, friendId],
				),
		]);

		return c.json({ success: true });
	});

	app.post("/api/friends/:friendId/report", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const friendId = parseFriendId(c.req.param("friendId"), user.id);
		if (friendId === null) {
			return c.json({ error: "Invalid friend ID" }, 400);
		}

		const { reason, details } = (await c.req.json()) as {
			reason?: string;
			details?: string;
		};
		const normalizedReason = reason?.trim() ?? "";
		const normalizedDetails = details?.trim() ?? "";

		if (normalizedReason.length < 2 || normalizedReason.length > 120) {
			return c.json({ error: "Invalid report reason" }, 400);
		}
		if (normalizedDetails.length > 2000) {
			return c.json({ error: "Report details too long" }, 400);
		}
		if (
			containsAbusiveText(normalizedReason) ||
			(normalizedDetails.length > 0 && containsAbusiveText(normalizedDetails))
		) {
			return c.json({ error: "Report contains disallowed language" }, 400);
		}

		const targetUserResult = await c
			.get("db")
			.query<User>("SELECT id FROM users WHERE id = $1", [friendId]);
		if (!targetUserResult.rows[0]) {
			return c.json({ error: "User not found" }, 404);
		}

		await c.get("db").query(
			`
				INSERT INTO user_reports (reporter_user_id, target_user_id, reason, details)
				VALUES ($1, $2, $3, $4)
			`,
			[
				user.id,
				friendId,
				normalizedReason,
				normalizedDetails.length > 0 ? normalizedDetails : null,
			],
		);

		return c.json({ success: true });
	});
}
