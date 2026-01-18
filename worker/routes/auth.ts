import type { App } from "../types";
import {
	authUserPayload,
	createSession,
	createUser,
	ensureUserPhoneForOtp,
	fetchUserByUsername,
	getPhoneAuthEnabled,
	normalizeUsername,
	SESSION_KV_PREFIX,
	sendOtpResponse,
	validateUsername,
	verifyOtp,
} from "../lib";

export function registerAuthRoutes(app: App) {
	app.post("/api/auth/start", async (c) => {
		const { username, phone } = await c.req.json();
		const trimmedUsername = normalizeUsername(username);
		const trimmedPhone = String(phone || "").trim();

		const usernameError = validateUsername(trimmedUsername);
		if (usernameError) {
			return c.json({ error: usernameError }, 400);
		}

		let user = await fetchUserByUsername(c.env, trimmedUsername);

		const phoneAuthEnabled = await getPhoneAuthEnabled(c.env);
		if (!phoneAuthEnabled) {
			if (!user) {
				const { user: createdUser } = await createUser(c.env, {
					username: trimmedUsername,
					phone: trimmedPhone || null,
					phoneVerified: 0,
				});
				user = createdUser;
			} else if (trimmedPhone && trimmedPhone !== user.phone) {
				await c.env.DB.prepare("UPDATE users SET phone = ? WHERE id = ?")
					.bind(trimmedPhone, user.id)
					.run();
			}

			if (!user) {
				return c.json({ error: "User not found" }, 404);
			}

			const sessionToken = await createSession(c.env, user);
			return c.json({
				status: "authenticated",
				user: authUserPayload(user),
				token: sessionToken,
			});
		}

		if (user?.phone) {
			return sendOtpResponse(c, {
				phone: user.phone,
				username: trimmedUsername,
			});
		}

		if (!trimmedPhone) {
			return c.json({ status: "needs_phone" });
		}

		user = await ensureUserPhoneForOtp(c.env, user, {
			username: trimmedUsername,
			phone: trimmedPhone,
		});

		return sendOtpResponse(c, {
			phone: trimmedPhone,
			username: trimmedUsername,
		});
	});

	app.post("/api/auth/verify", async (c) => {
		const { username, otp } = await c.req.json();
		const trimmedUsername = String(username || "").trim();
		const trimmedOtp = String(otp || "").trim();

		if (!trimmedUsername || !trimmedOtp) {
			return c.json({ error: "Missing verification code" }, 400);
		}

		const user = await fetchUserByUsername(c.env, trimmedUsername);

		if (!user) {
			return c.json({ error: "User not found" }, 404);
		}

		const phoneAuthEnabled = await getPhoneAuthEnabled(c.env);
		if (!phoneAuthEnabled) {
			const sessionToken = await createSession(c.env, user);
			return c.json({
				user: authUserPayload(user),
				token: sessionToken,
			});
		}

		const result = await verifyOtp(c.env, {
			otp: trimmedOtp,
			username: trimmedUsername,
		});

		if (!result.success) {
			return c.json({ error: "Verification failed" }, 400);
		}

		if (!result.isValidOtp) {
			return c.json({ error: "Invalid verification code" }, 400);
		}

		await c.env.DB.prepare("UPDATE users SET phone_verified = 1 WHERE id = ?")
			.bind(user.id)
			.run();
		const sessionToken = await createSession(c.env, user);

		return c.json({
			user: authUserPayload(user),
			token: sessionToken,
		});
	});

	app.get("/api/auth/session", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		return c.json({
			user: authUserPayload(user),
		});
	});

	app.post("/api/auth/logout", async (c) => {
		const user = c.get("user");
		const sessionToken = c.get("sessionToken");
		if (!user || !sessionToken) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		await c.env.DB.prepare("DELETE FROM sessions WHERE token = ?")
			.bind(sessionToken)
			.run();
		await c.env.OY2.delete(`${SESSION_KV_PREFIX}${sessionToken}`);

		return c.json({ success: true });
	});
}
