import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { Client } from "pg";
import { SESSION_KV_PREFIX } from "./lib";
import { registerAdminRoutes } from "./routes/admin";
import { registerAuthRoutes } from "./routes/auth";
import { registerEmailRoutes } from "./routes/email";
import { registerFriendRoutes } from "./routes/friends";
import { registerOAuthRoutes } from "./routes/oauth";
import { registerOyRoutes } from "./routes/oys";
import { registerPasskeyRoutes } from "./routes/passkey";
import { registerPushRoutes } from "./routes/push";
import { registerUserRoutes } from "./routes/users";
import type { AppContext, AppVariables, Bindings, User } from "./types";

const app = new Hono<{
	Bindings: Bindings;
	Variables: AppVariables;
}>();

app.use("*", async (c: AppContext, next) => {
	if (!c.get("db")) {
		if (c.env.TEST_DB) {
			c.set("db", c.env.TEST_DB);
		} else {
			const client = new Client({
				connectionString: c.env.HYPERDRIVE.connectionString,
			});
			c.set("db", client);
			await client.connect();
		}
	}
	await next();
});

app.use("*", async (c: AppContext, next) => {
	c.set("user", null);
	c.set("sessionToken", null);
	// Prefer cookie, fall back to header for tests
	const sessionToken =
		getCookie(c, "session") || c.req.header("x-session-token");
	if (sessionToken) {
		try {
			const sessionKey = `${SESSION_KV_PREFIX}${sessionToken}`;
			const cachedUser = await c.env.OY2.get(sessionKey, "json");
			let user = cachedUser as User | null;
			if (!user) {
				const userResult = await c
					.get("db")
					.query<User>(
						`SELECT users.*
						FROM sessions
						JOIN users ON users.id = sessions.user_id
						WHERE sessions.token = $1`,
						[sessionToken],
					)
					.catch((err) => {
						console.error("Error fetching user from DB:", err);
						return { rows: [] };
					});
				user = userResult.rows[0] ?? null;
				if (user) {
					c.executionCtx.waitUntil(
						c.env.OY2.put(sessionKey, JSON.stringify(user)),
					);
				}
			}
			c.set("user", user);
			if (user) {
				c.set("sessionToken", sessionToken);
			}
		} catch (err) {
			console.error("Error fetching user:", err);
		}
	}
	await next();
});

registerAuthRoutes(app);
registerOAuthRoutes(app);
registerEmailRoutes(app);
registerPasskeyRoutes(app);
registerUserRoutes(app);
registerFriendRoutes(app);
registerOyRoutes(app);
registerPushRoutes(app);
registerAdminRoutes(app);

export default app;
