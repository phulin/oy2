import type { App, FriendUser } from "../types";
import {
	createUser,
	fetchUserByUsername,
	normalizeUsername,
	validateUsername,
} from "../lib";

export function registerUserRoutes(app: App) {
	app.post("/api/users", async (c) => {
		const { username } = await c.req.json();
		const trimmedUsername = normalizeUsername(username);

		const usernameError = validateUsername(trimmedUsername);
		if (usernameError) {
			return c.json({ error: usernameError }, 400);
		}

		let user = await fetchUserByUsername(c.env, trimmedUsername);

		if (!user) {
			try {
				const { user: createdUser, result } = await createUser(c.env, {
					username: trimmedUsername,
				});
				if (!result.success) {
					return c.json({ error: "Username already taken" }, 400);
				}
				user = createdUser;
			} catch (_err) {
				return c.json({ error: "Username already taken" }, 400);
			}
		}

		return c.json({ user });
	});

	app.get("/api/users/search", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}
		const q = c.req.query("q");
		const trimmedQuery = q?.trim() ?? "";

		if (trimmedQuery.length < 2) {
			return c.json({ users: [] });
		}

		const users = await c.env.DB.prepare(
			"SELECT id, username FROM users WHERE username COLLATE NOCASE LIKE ? LIMIT 20",
		)
			.bind(`%${trimmedQuery}%`)
			.all();

		const userResults = (users.results || []) as FriendUser[];
		return c.json({ users: userResults });
	});

	app.get("/api/users/suggested", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const suggestions = await c.env.DB.prepare(
			`
    WITH current_friends AS (
      SELECT friend_id
      FROM friendships
      WHERE user_id = ?
    ),
    mutual_counts AS (
      SELECT f.user_id AS candidate_id, COUNT(*) AS mutuals
      FROM friendships f
      INNER JOIN current_friends cf ON cf.friend_id = f.friend_id
      WHERE f.user_id != ?
      GROUP BY f.user_id
    )
    SELECT u.id, u.username, mutual_counts.mutuals
    FROM mutual_counts
    INNER JOIN users u ON u.id = mutual_counts.candidate_id
    WHERE mutual_counts.mutuals > 0
      AND u.id NOT IN (SELECT friend_id FROM current_friends)
      AND u.id != ?
    ORDER BY mutual_counts.mutuals DESC, u.username
    LIMIT 8
  `,
		)
			.bind(user.id, user.id, user.id)
			.all();

		const suggestionResults = (suggestions.results || []) as FriendUser[];
		return c.json({ users: suggestionResults });
	});
}
