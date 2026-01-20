import { computeStreakLength, getStreakDateBoundaries } from "../lib";
import type { App, FriendListRow, LastYoInfoRow, User } from "../types";

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

		return c.json({ success: true });
	});

	app.get("/api/friends", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const friends = await c.get("db").query<FriendListRow>(
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

	app.get("/api/last-yo-info", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const lastYoInfo = await c.get("db").query<LastYoInfoRow>(
			`
    SELECT
      friend_id,
      last_yo_type,
      last_yo_created_at,
      last_yo_from_user_id,
      streak_start_date
    FROM last_yo_info
    WHERE user_id = $1
  `,
			[user.id],
		);

		const { startOfTodayNY, startOfYesterdayNY } = getStreakDateBoundaries();
		const results = lastYoInfo.rows.map((info) => {
			const streak = computeStreakLength({
				lastYoCreatedAt: info.last_yo_created_at,
				streakStartDate: info.streak_start_date,
				startOfTodayNY,
				startOfYesterdayNY,
			});
			return {
				friend_id: info.friend_id,
				last_yo_type: info.last_yo_type,
				last_yo_created_at: info.last_yo_created_at,
				last_yo_from_user_id: info.last_yo_from_user_id,
				streak,
			};
		});
		return c.json({ lastYoInfo: results });
	});
}
