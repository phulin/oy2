import type { App, AppContext, FriendUser } from "../types";

export function registerUserRoutes(app: App) {
	const escapeLikePattern = (value: string) => value.replace(/[\\%_]/g, "\\$&");
	const parseUserId = (
		userIdRaw: string | undefined,
		currentUserId: number,
	): number | null => {
		const userId = Number(userIdRaw);
		if (!Number.isInteger(userId) || userId <= 0 || userId === currentUserId) {
			return null;
		}
		return userId;
	};

	app.get("/api/users/search", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}
		const q = c.req.query("q");
		const trimmedQuery = q?.trim() ?? "";

		if (trimmedQuery.length < 2) {
			return c.json({ users: [] });
		}

		const escapedQuery = escapeLikePattern(trimmedQuery);
		const users = await c.get("db").query<FriendUser>(
			`
					SELECT u.id, u.username
					FROM users u
					LEFT JOIN user_blocks b1
						ON b1.blocker_user_id = $2 AND b1.blocked_user_id = u.id
					LEFT JOIN user_blocks b2
						ON b2.blocker_user_id = u.id AND b2.blocked_user_id = $3
					WHERE u.username ILIKE $1 ESCAPE '\\'
						AND u.id != $4
						AND b1.blocker_user_id IS NULL
						AND b2.blocker_user_id IS NULL
					LIMIT 20
				`,
			[`%${escapedQuery}%`, user.id, user.id, user.id],
		);

		const userResults = users.rows;
		return c.json({ users: userResults });
	});

	app.get("/api/users/suggested", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const suggestions = await c.get("db").query<FriendUser>(
			`
    WITH blocked_users AS (
      SELECT blocked_user_id AS user_id
      FROM user_blocks
      WHERE blocker_user_id = $1
      UNION
      SELECT blocker_user_id AS user_id
      FROM user_blocks
      WHERE blocked_user_id = $2
    ),
    current_friends AS (
      SELECT friend_id
      FROM friendships
      WHERE user_id = $1
        AND friend_id NOT IN (SELECT user_id FROM blocked_users)
    ),
    mutual_counts AS (
      SELECT f.user_id AS candidate_id, COUNT(*) AS mutuals
      FROM friendships f
      INNER JOIN current_friends cf ON cf.friend_id = f.friend_id
      WHERE f.user_id != $3
        AND f.user_id NOT IN (SELECT user_id FROM blocked_users)
      GROUP BY f.user_id
    )
    SELECT u.id, u.username, mutual_counts.mutuals
    FROM mutual_counts
    INNER JOIN users u ON u.id = mutual_counts.candidate_id
    WHERE mutual_counts.mutuals > 0
      AND u.id NOT IN (SELECT friend_id FROM current_friends)
      AND u.id != $4
      AND u.id NOT IN (SELECT user_id FROM blocked_users)
    ORDER BY mutual_counts.mutuals DESC, u.username
    LIMIT 8
  `,
			[user.id, user.id, user.id, user.id],
		);

		const suggestionResults = suggestions.rows;
		return c.json({ users: suggestionResults });
	});

	app.post("/api/users/suggested/mutuals", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const { userIds } = await c.req.json();
		if (!Array.isArray(userIds) || userIds.length === 0) {
			return c.json({ mutuals: {} });
		}

		const placeholders = userIds.map((_, index) => `$${index + 2}`).join(", ");
		const mutualsResult = await c.get("db").query<{
			candidate_id: number;
			mutual_username: string;
		}>(
			`
    WITH blocked_users AS (
      SELECT blocked_user_id AS user_id
      FROM user_blocks
      WHERE blocker_user_id = $1
      UNION
      SELECT blocker_user_id AS user_id
      FROM user_blocks
      WHERE blocked_user_id = $1
    ),
    current_friends AS (
      SELECT friend_id
      FROM friendships
      WHERE user_id = $1
        AND friend_id NOT IN (SELECT user_id FROM blocked_users)
    ),
    ranked_mutuals AS (
      SELECT f.user_id AS candidate_id,
             u.username AS mutual_username,
             ROW_NUMBER() OVER (PARTITION BY f.user_id ORDER BY u.username) AS rn
      FROM friendships f
      INNER JOIN current_friends cf ON cf.friend_id = f.friend_id
      INNER JOIN users u ON u.id = f.friend_id
      WHERE f.user_id IN (${placeholders})
        AND f.user_id NOT IN (SELECT user_id FROM blocked_users)
    )
    SELECT candidate_id, mutual_username
    FROM ranked_mutuals
    WHERE rn <= 5
    ORDER BY candidate_id, mutual_username
  `,
			[user.id, ...userIds],
		);

		const rows = mutualsResult.rows;
		const mutuals: Record<number, string[]> = {};
		for (const row of rows) {
			const list = mutuals[row.candidate_id] ?? [];
			list.push(row.mutual_username);
			mutuals[row.candidate_id] = list;
		}

		return c.json({ mutuals });
	});

	app.get("/api/users/blocked", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const blockedUsers = await c.get("db").query<{
			id: number;
			username: string;
			blocked_at: number;
		}>(
			`
				SELECT u.id, u.username, b.created_at AS blocked_at
				FROM user_blocks b
				INNER JOIN users u ON u.id = b.blocked_user_id
				WHERE b.blocker_user_id = $1
				ORDER BY b.created_at DESC, u.username
			`,
			[user.id],
		);

		return c.json({ users: blockedUsers.rows });
	});

	app.delete("/api/users/block/:id", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const blockedUserId = parseUserId(c.req.param("id"), user.id);
		if (blockedUserId === null) {
			return c.json({ error: "Invalid user ID" }, 400);
		}

		const targetResult = await c
			.get("db")
			.query<FriendUser>("SELECT id, username FROM users WHERE id = $1", [
				blockedUserId,
			]);
		if (!targetResult.rows[0]) {
			return c.json({ error: "User not found" }, 404);
		}

		await c
			.get("db")
			.query(
				"DELETE FROM user_blocks WHERE blocker_user_id = $1 AND blocked_user_id = $2",
				[user.id, blockedUserId],
			);

		return c.json({ success: true });
	});
}
