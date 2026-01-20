import { deleteCookie, setCookie } from "hono/cookie";
import {
	authUserPayload,
	createSession,
	fetchUserByUsername,
	getPhoneAuthEnabled,
	normalizeUsername,
	SESSION_KV_PREFIX,
	sendOtpResponse,
	updateLastSeen,
	validateUsername,
	verifyOtp,
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
		const result = await c.get("db").query<User>(
			`INSERT INTO users (username)
			 VALUES ($1)
			 ON CONFLICT (username) DO NOTHING
			 RETURNING *`,
			[nextUsername],
		);
		return result.rows[0] ?? null;
	};
	const updateUserPhone = async (
		c: AppContext,
		userId: number,
		nextPhone: string,
		phoneVerified: number,
	) => {
		const result = await c
			.get("db")
			.query<User>(
				"UPDATE users SET phone = $1, phone_verified = $2 WHERE id = $3 RETURNING *",
				[nextPhone, phoneVerified, userId],
			);
		return result.rows[0] as User;
	};

	app.post("/api/auth/start", async (c: AppContext) => {
		const { username } = await c.req.json();
		const trimmedUsername = normalizeUsername(username);

		const usernameError = validateUsername(trimmedUsername);
		if (usernameError) {
			return c.json({ error: usernameError }, 400);
		}

		let user = await fetchUserByUsername(c, trimmedUsername);

		const phoneAuthEnabled = await getPhoneAuthEnabled(c);
		if (phoneAuthEnabled) {
			if (!user?.phone) {
				return c.json({ status: "needs_phone" });
			}

			return sendOtpResponse(c, {
				phone: user.phone,
				username: trimmedUsername,
			});
		}

		if (!user) {
			user = await createUserIfMissing(c, trimmedUsername);
		}

		const sessionToken = await createSession(c, user);
		setSessionCookie(c, sessionToken);
		updateLastSeen(c, user.id);
		return c.json({
			status: "authenticated",
			user: authUserPayload(user),
		});
	});

	app.post("/api/auth/phone", async (c: AppContext) => {
		const { username, phone } = await c.req.json();
		const trimmedUsername = normalizeUsername(username);
		const trimmedPhone = String(phone || "").trim();

		const usernameError = validateUsername(trimmedUsername);
		if (usernameError) {
			return c.json({ error: usernameError }, 400);
		}
		if (!trimmedPhone) {
			return c.json({ error: "Missing phone number" }, 400);
		}

		const phoneAuthEnabled = await getPhoneAuthEnabled(c);
		if (!phoneAuthEnabled) {
			return c.json({ error: "Phone authentication is disabled" }, 400);
		}

		const user = await fetchUserByUsername(c, trimmedUsername);
		if (!user) {
			return c.json({ error: "User not found" }, 404);
		}
		if (user?.phone) {
			return c.json({ error: "Phone number already set" }, 400);
		}
		await updateUserPhone(c, user.id, trimmedPhone, 0);

		return sendOtpResponse(c, {
			phone: trimmedPhone,
			username: trimmedUsername,
		});
	});

	app.post("/api/auth/verify", async (c: AppContext) => {
		const { username, otp } = await c.req.json();
		const trimmedUsername = String(username || "").trim();
		const trimmedOtp = String(otp || "").trim();

		if (!trimmedUsername || !trimmedOtp) {
			return c.json({ error: "Missing verification code" }, 400);
		}

		const user = await fetchUserByUsername(c, trimmedUsername);

		if (!user) {
			return c.json({ error: "User not found" }, 404);
		}

		const phoneAuthEnabled = await getPhoneAuthEnabled(c);
		if (phoneAuthEnabled) {
			const result = await verifyOtp(c, {
				otp: trimmedOtp,
				username: trimmedUsername,
			});

			if (!result.success) {
				return c.json({ error: "Verification failed" }, 400);
			}

			if (!result.isValidOtp) {
				return c.json({ error: "Invalid verification code" }, 400);
			}

			if (!user.phone_verified) {
				await c
					.get("db")
					.query("UPDATE users SET phone_verified = 1 WHERE id = $1", [
						user.id,
					]);
			}
		}

		const sessionToken = await createSession(c, user);
		setSessionCookie(c, sessionToken);
		updateLastSeen(c, user.id);

		return c.json({
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
