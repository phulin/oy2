import { deleteCookie } from "hono/cookie";
import { authUserPayload, SESSION_KV_PREFIX } from "../lib";
import type { App, AppContext } from "../types";

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
		await c.env.OY2.delete(`${SESSION_KV_PREFIX}${sessionToken}`);
		clearSessionCookie(c);

		return c.json({ success: true });
	});
}
