import { Hono } from "hono";
import type { AppVariables, Bindings, User } from "./types";
import { SESSION_KV_PREFIX } from "./lib";
import { registerAdminRoutes } from "./routes/admin";
import { registerAuthRoutes } from "./routes/auth";
import { registerFriendRoutes } from "./routes/friends";
import { registerOyRoutes } from "./routes/oys";
import { registerPushRoutes } from "./routes/push";
import { registerUserRoutes } from "./routes/users";

const app = new Hono<{
	Bindings: Bindings;
	Variables: AppVariables;
}>();

const bootTime = performance.now();

app.use("*", async (c, next) => {
	const bootMs = performance.now() - bootTime;
	const handlerStart = performance.now();
	c.set("bootMs", bootMs);
	await next();
	const handlerMs = performance.now() - handlerStart;
	c.header(
		"Server-Timing",
		`boot;dur=${bootMs.toFixed(1)}, handler;dur=${handlerMs.toFixed(1)}`,
	);
});

app.use("*", async (c, next) => {
	c.set("user", null);
	c.set("sessionToken", null);
	const sessionToken = c.req.header("x-session-token");
	if (sessionToken) {
		try {
			const sessionKey = `${SESSION_KV_PREFIX}${sessionToken}`;
			const cachedUser = await c.env.OY2.get(sessionKey, "json");
			const user =
				(cachedUser as User | null) ??
				((await c.env.DB.prepare(
					`SELECT users.*
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token = ?`,
				)
					.bind(sessionToken)
					.first()) as User | null);
			c.set("user", user ?? null);
			if (user) {
				c.set("sessionToken", sessionToken);
				const now = Math.floor(Date.now() / 1000);
				const updatePromise = c.env.DB.prepare(
					"UPDATE users SET last_seen = ? WHERE id = ?",
				)
					.bind(now, user.id)
					.run();
				let cachePromise: Promise<void> | null = null;
				if (!cachedUser) {
					const cachedUserValue = { ...user, last_seen: null };
					cachePromise = c.env.OY2.put(
						sessionKey,
						JSON.stringify(cachedUserValue),
					);
				}
				c.executionCtx.waitUntil(
					cachePromise
						? Promise.all([updatePromise, cachePromise])
						: updatePromise,
				);
			}
		} catch (err) {
			console.error("Error fetching user:", err);
		}
	}
	await next();
});

registerAuthRoutes(app);
registerUserRoutes(app);
registerFriendRoutes(app);
registerOyRoutes(app);
registerPushRoutes(app);
registerAdminRoutes(app);

export default app;
