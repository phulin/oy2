import { deleteCookie } from "hono/cookie";
import { authUserPayload, validateUsername } from "../lib";
import type { App, AppContext, User } from "../types";

const DELETE_RATE_PREFIX = "account_delete_rate:";
const DELETE_RATE_TTL_SECONDS = 60 * 60;
const DELETE_RATE_LIMIT_MAX = 3;

type DeleteRateData = {
	count: number;
};

function clearSessionCookie(c: AppContext) {
	deleteCookie(c, "session", { path: "/" });
}

export function registerAuthRoutes(app: App) {
	app.get("/api/auth/session", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		return c.json({
			user: authUserPayload(user),
		});
	});

	app.post("/api/auth/username/check", async (c: AppContext) => {
		const { username } = await c.req.json();
		const trimmed = String(username || "")
			.trim()
			.toLowerCase();

		const formatError = validateUsername(trimmed);
		if (formatError) {
			return c.json({ available: false, error: formatError }, 400);
		}

		if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
			return c.json(
				{
					available: false,
					error: "Username can only contain letters, numbers, and underscores",
				},
				400,
			);
		}

		const existing = await c
			.get("db")
			.query<User>("SELECT * FROM users WHERE LOWER(username) = $1", [trimmed]);

		if (existing.rows.length > 0) {
			const user = existing.rows[0];
			// Check if this is a claimable placeholder account
			const hasOauth = !!user.oauth_provider;
			const hasEmail = !!user.email;
			const passkeys = await c
				.get("db")
				.query("SELECT id FROM passkeys WHERE user_id = $1 LIMIT 1", [user.id]);
			const hasPasskey = passkeys.rows.length > 0;

			if (hasOauth || hasEmail || hasPasskey) {
				return c.json({ available: false, error: "Username already taken" });
			}
			// Claimable placeholder — treat as available
		}

		return c.json({ available: true });
	});

	app.post("/api/auth/logout", async (c: AppContext) => {
		const user = c.get("user");
		const sessionToken = c.get("sessionToken");
		if (!user || !sessionToken) {
			clearSessionCookie(c);
			return c.json({ error: "Not authenticated" }, 401);
		}

		await c
			.get("db")
			.query("DELETE FROM sessions WHERE token = $1", [sessionToken]);
		clearSessionCookie(c);

		return c.json({ success: true });
	});

	app.delete("/api/auth/account", async (c: AppContext) => {
		const user = c.get("user");
		const sessionToken = c.get("sessionToken");
		if (!user || !sessionToken) {
			clearSessionCookie(c);
			return c.json({ error: "Not authenticated" }, 401);
		}

		const rateKey = `${DELETE_RATE_PREFIX}${user.id}`;
		const rateDataRaw = await c.env.OY2.get(rateKey);
		const rateData = rateDataRaw
			? (JSON.parse(rateDataRaw) as DeleteRateData)
			: { count: 0 };
		if (rateData.count >= DELETE_RATE_LIMIT_MAX) {
			return c.json(
				{
					error: "Too many account deletion attempts. Please try again later.",
				},
				429,
			);
		}

		await c.env.OY2.put(
			rateKey,
			JSON.stringify({ count: rateData.count + 1 }),
			{ expirationTtl: DELETE_RATE_TTL_SECONDS },
		);

		await c.get("db").query("DELETE FROM users WHERE id = $1", [user.id]);
		clearSessionCookie(c);

		return c.json({ success: true });
	});
}
