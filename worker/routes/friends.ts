import { computeStreakLength, getStreakDateBoundaries } from "../lib";
import type { App, FriendListRow, LastOyInfoRow, User } from "../types";

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
    WHERE f.user_id = $1
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
}
