import { deleteCookie, setCookie } from "hono/cookie";
import {
	authUserPayload,
	createSession,
	fetchUserByUsername,
	normalizeUsername,
	SESSION_KV_PREFIX,
	updateLastSeen,
	validateUsername,
} from "../lib";
import type { App, AppContext, User } from "../types";

function setSessionCookie(c: AppContext, token: string) {
	setCookie(c, "session", token, {
		httpOnly: true,
		secure: true,
		sameSite: "Strict",
		path: "/",
		maxAge: 60 * 60 * 24 * 365, // 1 year
	});
}

function clearSessionCookie(c: AppContext) {
	deleteCookie(c, "session", { path: "/" });
}

export function registerAuthRoutes(app: App) {
	const createUserIfMissing = async (c: AppContext, nextUsername: string) => {
		const result = await c.get("db").query<User | null>(
			`INSERT INTO users (username)
			 VALUES ($1)
			 ON CONFLICT (username) DO NOTHING
			 RETURNING *`,
			[nextUsername],
		);
		return result.rows[0] ?? null;
	};

	app.post("/api/auth/start", async (c: AppContext) => {
		const { username } = await c.req.json();
		const trimmedUsername = normalizeUsername(username);

		const usernameError = validateUsername(trimmedUsername);
		if (usernameError) {
			return c.json({ error: usernameError }, 400);
		}

		let user = await fetchUserByUsername(c, trimmedUsername);

		if (!user) {
			user = await createUserIfMissing(c, trimmedUsername);
		}

		if (!user) {
			return c.json({ error: "User not found" }, 404);
		}

		const sessionToken = await createSession(c, user);
		setSessionCookie(c, sessionToken);
		updateLastSeen(c, user.id);
		return c.json({
			status: "authenticated",
			user: authUserPayload(user),
		});
	});

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
