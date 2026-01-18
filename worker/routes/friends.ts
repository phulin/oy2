import { computeStreakLength, getStreakDateBoundaries } from "../lib";
import type { App, FriendListRow, User } from "../types";

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

		const friend = (await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
			.bind(friendId)
			.first()) as User | null;

		if (!friend) {
			return c.json({ error: "User not found" }, 404);
		}

		await c.env.DB.batch([
			c.env.DB.prepare(
				"INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)",
			).bind(user.id, friendId),
			c.env.DB.prepare(
				"INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)",
			).bind(friendId, user.id),
		]);

		return c.json({ success: true });
	});

	app.get("/api/friends", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const friends = await c.env.DB.prepare(
			`
    SELECT
      u.id,
      u.username,
      f.last_yo_type,
      f.last_yo_created_at,
      f.last_yo_from_user_id,
      f.streak_start_date
    FROM friendships f
    INNER JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ?
    ORDER BY u.username
  `,
		)
			.bind(user.id)
			.all();

		const { startOfTodayNY, startOfYesterdayNY } = getStreakDateBoundaries();
		const friendResults = (friends.results || []).map((row) => {
			const friend = row as FriendListRow;
			const streak = computeStreakLength({
				lastYoCreatedAt: friend.last_yo_created_at,
				streakStartDate: friend.streak_start_date,
				startOfTodayNY,
				startOfYesterdayNY,
			});
			return {
				id: friend.id,
				username: friend.username,
				last_yo_type: friend.last_yo_type,
				last_yo_created_at: friend.last_yo_created_at,
				last_yo_from_user_id: friend.last_yo_from_user_id,
				streak,
			};
		});
		return c.json({ friends: friendResults });
	});
}
