import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { Client } from "pg";
import { registerAdminRoutes } from "./routes/admin";
import { registerAuthRoutes } from "./routes/auth";
import { registerEmailRoutes } from "./routes/email";
import { registerFriendRoutes } from "./routes/friends";
import { registerMiscRoutes } from "./routes/misc";
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

app.use(
	"*",
	cors({
		origin: [
			"https://oyme.site",
			"capacitor://oyme.site",
			"http://localhost",
			"http://127.0.0.1",
		],
		allowHeaders: ["Content-Type", "X-Session-Token"],
		allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
		credentials: true,
	}),
);

app.use("*", async (c: AppContext, next) => {
	if (!c.get("db")) {
		if (c.env.TEST_DB) {
			c.set("db", c.env.TEST_DB);
			c.set("dbNoCache", c.env.TEST_DB);
		} else {
			const client = new Client({
				connectionString: c.env.HYPERDRIVE.connectionString,
			});
			c.set("db", client);
			const clientNoCache = new Client({
				connectionString: c.env.HYPERDRIVE_NO_CACHE.connectionString,
			});
			c.set("dbNoCache", clientNoCache);
			await Promise.all([client.connect(), clientNoCache.connect()]);
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
			const userResult = await c
				.get("dbNoCache")
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
			const user = userResult.rows[0] ?? null;
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

registerMiscRoutes(app);
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
