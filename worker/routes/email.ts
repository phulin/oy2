import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
	authUserPayload,
	createSession,
	invalidateUserSessionsCache,
	updateLastSeen,
} from "../lib";
import type { App, AppContext, User } from "../types";

const EMAIL_CODE_PREFIX = "email_code:";
const EMAIL_RATE_PREFIX = "email_rate:";
const EMAIL_PENDING_PREFIX = "email_pending:";
const EMAIL_ADD_PREFIX = "email_add:";

type EmailCodeData = {
	code: string;
	attempts: number;
};
type EmailRateData = {
	count: number;
};
type EmailAddData = {
	email: string;
	code: string;
	attempts: number;
};

function generateVerificationCode(): string {
	const array = new Uint8Array(4);
	crypto.getRandomValues(array);
	const num =
		((array[0] << 24) | (array[1] << 16) | (array[2] << 8) | array[3]) >>> 0;
	return String(num % 1000000).padStart(6, "0");
}

async function generatePendingId(): Promise<string> {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function setSessionCookie(c: AppContext, token: string) {
	setCookie(c, "session", token, {
		httpOnly: true,
		secure: true,
		sameSite: "Strict",
		path: "/",
		maxAge: 60 * 60 * 24 * 365,
	});
}

function generateEmailHtml(code: string): string {
	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 40px 20px; margin: 0;">
  <div style="max-width: 400px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 40px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <h1 style="font-size: 48px; font-weight: 900; color: #4b50f0; margin: 0 0 16px; letter-spacing: -1px;">Oy</h1>
    <h2 style="font-size: 20px; color: #333; margin: 0 0 24px; font-weight: 500;">Your verification code</h2>
    <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 0 0 24px;">
      <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #4b50f0; font-family: monospace;">${code}</span>
    </div>
    <p style="font-size: 14px; color: #666; margin: 0 0 8px;">
      This code expires in 10 minutes.
    </p>
    <p style="font-size: 13px; color: #999; margin: 0;">
      If you didn't request this code, you can safely ignore this email.
    </p>
  </div>
</body>
</html>`;
}

function timingSafeEqualString(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

async function sendEmailCode(
	c: AppContext,
	{ email, code }: { email: string; code: string },
): Promise<{ success: boolean; error?: string }> {
	try {
		const response = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: "Oy <noreply@oyme.site>",
				to: [email],
				subject: `${code} is your Oy verification code`,
				html: generateEmailHtml(code),
			}),
		});

		if (!response.ok) {
			const errorData = (await response.json()) as { message?: string };
			return {
				success: false,
				error: errorData.message || "Failed to send email",
			};
		}

		return { success: true };
	} catch (_err) {
		return { success: false, error: "Failed to send email" };
	}
}

function isValidEmail(email: string): boolean {
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return emailRegex.test(email) && email.length <= 254;
}

export function registerEmailRoutes(app: App) {
	// Send verification code to email
	app.post("/api/auth/email/send-code", async (c: AppContext) => {
		const body = await c.req.json();
		const email = String(body.email || "")
			.trim()
			.toLowerCase();

		if (!email || !isValidEmail(email)) {
			return c.json({ error: "Invalid email address" }, 400);
		}

		// Check rate limit (max 3 codes per email per minute)
		const rateKey = `${EMAIL_RATE_PREFIX}${email}`;
		const rateDataRaw = await c.env.OY2.get(rateKey);
		const rateData = rateDataRaw
			? (JSON.parse(rateDataRaw) as EmailRateData)
			: { count: 0 };
		if (rateData.count >= 3) {
			return c.json(
				{
					error:
						"Too many requests. Please wait before requesting another code.",
				},
				429,
			);
		}
		await c.env.OY2.put(
			rateKey,
			JSON.stringify({ count: rateData.count + 1 }),
			{ expirationTtl: 60 },
		);

		// Generate and store new code
		const code = generateVerificationCode();
		await c.env.OY2.put(
			`${EMAIL_CODE_PREFIX}${email}`,
			JSON.stringify({ code, attempts: 0 }),
			{ expirationTtl: 600 },
		);

		const result = await sendEmailCode(c, { email, code });
		if (!result.success) {
			// Clean up the stored code if email failed
			await c.env.OY2.delete(`${EMAIL_CODE_PREFIX}${email}`);
			return c.json({ error: result.error || "Failed to send email" }, 500);
		}

		return c.json({ status: "code_sent" });
	});

	// Verify the code
	app.post("/api/auth/email/verify", async (c: AppContext) => {
		const body = await c.req.json();
		const email = String(body.email || "")
			.trim()
			.toLowerCase();
		const code = String(body.code || "").trim();

		if (!email || !code) {
			return c.json({ error: "Email and code are required" }, 400);
		}

		// Get stored code
		const storedData = await c.env.OY2.get(`${EMAIL_CODE_PREFIX}${email}`);
		if (!storedData) {
			return c.json(
				{ error: "Code expired or not found. Please request a new code." },
				400,
			);
		}

		const data = JSON.parse(storedData) as EmailCodeData;

		// Check attempts (max 5)
		if (data.attempts >= 5) {
			await c.env.OY2.delete(`${EMAIL_CODE_PREFIX}${email}`);
			return c.json(
				{ error: "Too many failed attempts. Please request a new code." },
				400,
			);
		}

		// Verify code (constant-time comparison)
		const codeMatches = timingSafeEqualString(code, data.code);

		if (!codeMatches) {
			// Increment attempts
			await c.env.OY2.put(
				`${EMAIL_CODE_PREFIX}${email}`,
				JSON.stringify({ ...data, attempts: data.attempts + 1 }),
				{ expirationTtl: 600 },
			);
			return c.json({ error: "Invalid code" }, 400);
		}

		// Code is valid - delete it
		await c.env.OY2.delete(`${EMAIL_CODE_PREFIX}${email}`);

		// Check if user exists with this email
		const existingUser = await c
			.get("db")
			.query<User>("SELECT * FROM users WHERE LOWER(email) = $1", [email]);

		if (existingUser.rows[0]) {
			// Existing user - log them in
			const user = existingUser.rows[0];
			const sessionToken = await createSession(c, user);
			setSessionCookie(c, sessionToken);
			updateLastSeen(c, user.id);

			// Check if they have a passkey
			const passkeys = await c
				.get("db")
				.query("SELECT id FROM passkeys WHERE user_id = $1 LIMIT 1", [user.id]);

			return c.json({
				status: "authenticated",
				user: authUserPayload(user),
				needsPasskeySetup: passkeys.rows.length === 0,
			});
		}

		// New user - store pending email and redirect to username selection
		const pendingId = await generatePendingId();
		await c.env.OY2.put(
			`${EMAIL_PENDING_PREFIX}${pendingId}`,
			JSON.stringify({ email }),
			{ expirationTtl: 600 },
		);

		setCookie(c, "email_pending", pendingId, {
			httpOnly: true,
			secure: true,
			sameSite: "Strict",
			path: "/",
			maxAge: 600,
		});

		return c.json({ status: "choose_username" });
	});

	// Complete registration with username (for new email users)
	app.post("/api/auth/email/complete", async (c: AppContext) => {
		const pendingId = getCookie(c, "email_pending");
		if (!pendingId) {
			return c.json({ error: "No pending email registration" }, 400);
		}

		const pendingData = await c.env.OY2.get(
			`${EMAIL_PENDING_PREFIX}${pendingId}`,
		);
		if (!pendingData) {
			return c.json({ error: "Email session expired" }, 400);
		}

		const { email } = JSON.parse(pendingData) as { email: string };

		const body = await c.req.json();
		const trimmedUsername = String(body.username || "")
			.trim()
			.toLowerCase();

		if (!trimmedUsername) {
			return c.json({ error: "Username is required" }, 400);
		}

		// Check if username exists
		const existing = await c
			.get("db")
			.query<User>("SELECT * FROM users WHERE LOWER(username) = $1", [
				trimmedUsername,
			]);

		if (existing.rows.length > 0) {
			const existingUser = existing.rows[0];

			// If user already has OAuth linked, they can't claim it via email
			if (existingUser.oauth_provider) {
				return c.json({ error: "Username already taken" }, 400);
			}

			// If user has a passkey, they've already claimed their account
			const passkeys = await c
				.get("db")
				.query("SELECT id FROM passkeys WHERE user_id = $1 LIMIT 1", [
					existingUser.id,
				]);
			if (passkeys.rows.length > 0) {
				return c.json({ error: "Username already taken" }, 400);
			}

			// If user already has an email set, they can't claim it with a different email
			if (existingUser.email && existingUser.email.toLowerCase() !== email) {
				return c.json({ error: "Username already taken" }, 400);
			}

			// Claim the existing user by adding email
			await c
				.get("db")
				.query(`UPDATE users SET email = $1 WHERE id = $2`, [
					email,
					existingUser.id,
				]);
			await invalidateUserSessionsCache(c, existingUser.id);
			existingUser.email = email;

			// Clean up pending data
			await c.env.OY2.delete(`${EMAIL_PENDING_PREFIX}${pendingId}`);
			deleteCookie(c, "email_pending", { path: "/" });

			// Create session for claimed user
			const sessionToken = await createSession(c, existingUser);
			setSessionCookie(c, sessionToken);
			updateLastSeen(c, existingUser.id);

			return c.json({
				user: authUserPayload(existingUser),
				claimed: true,
				needsPasskeySetup: true,
			});
		}

		// Create new user
		const result = await c.get("db").query<User>(
			`INSERT INTO users (username, email)
			 VALUES ($1, $2)
			 RETURNING *`,
			[trimmedUsername, email],
		);

		const user = result.rows[0];

		// Clean up pending data
		await c.env.OY2.delete(`${EMAIL_PENDING_PREFIX}${pendingId}`);
		deleteCookie(c, "email_pending", { path: "/" });

		// Create session
		const sessionToken = await createSession(c, user);
		setSessionCookie(c, sessionToken);
		updateLastSeen(c, user.id);

		return c.json({
			user: authUserPayload(user),
			needsPasskeySetup: true,
		});
	});

	// Send verification code to add email for authenticated users
	app.post("/api/auth/email/add/send-code", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const body = await c.req.json();
		const email = String(body.email || "")
			.trim()
			.toLowerCase();

		if (!email || !isValidEmail(email)) {
			return c.json({ error: "Invalid email address" }, 400);
		}

		if (user.email?.toLowerCase() === email) {
			return c.json({ status: "already_set", email });
		}

		const existingUser = await c
			.get("db")
			.query<User>("SELECT * FROM users WHERE LOWER(email) = $1", [email]);
		if (existingUser.rows[0] && existingUser.rows[0].id !== user.id) {
			return c.json({ error: "Email already in use" }, 400);
		}

		// Check rate limit (max 3 codes per email per minute)
		const rateKey = `${EMAIL_RATE_PREFIX}${email}`;
		const rateDataRaw = await c.env.OY2.get(rateKey);
		const rateData = rateDataRaw
			? (JSON.parse(rateDataRaw) as EmailRateData)
			: { count: 0 };
		if (rateData.count >= 3) {
			return c.json(
				{
					error:
						"Too many requests. Please wait before requesting another code.",
				},
				429,
			);
		}
		await c.env.OY2.put(
			rateKey,
			JSON.stringify({ count: rateData.count + 1 }),
			{ expirationTtl: 60 },
		);

		const code = generateVerificationCode();
		await c.env.OY2.put(
			`${EMAIL_ADD_PREFIX}${user.id}`,
			JSON.stringify({ email, code, attempts: 0 }),
			{ expirationTtl: 600 },
		);

		const result = await sendEmailCode(c, { email, code });
		if (!result.success) {
			await c.env.OY2.delete(`${EMAIL_ADD_PREFIX}${user.id}`);
			return c.json({ error: result.error || "Failed to send email" }, 500);
		}

		return c.json({ status: "code_sent", email });
	});

	// Verify code and update email for authenticated users
	app.post("/api/auth/email/add/verify", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const body = await c.req.json();
		const code = String(body.code || "").trim();
		if (!code) {
			return c.json({ error: "Code is required" }, 400);
		}

		const storedData = await c.env.OY2.get(`${EMAIL_ADD_PREFIX}${user.id}`);
		if (!storedData) {
			return c.json(
				{ error: "Code expired or not found. Please request a new code." },
				400,
			);
		}

		const data = JSON.parse(storedData) as EmailAddData;

		if (data.attempts >= 5) {
			await c.env.OY2.delete(`${EMAIL_ADD_PREFIX}${user.id}`);
			return c.json(
				{ error: "Too many failed attempts. Please request a new code." },
				400,
			);
		}

		const codeMatches = timingSafeEqualString(code, data.code);
		if (!codeMatches) {
			await c.env.OY2.put(
				`${EMAIL_ADD_PREFIX}${user.id}`,
				JSON.stringify({ ...data, attempts: data.attempts + 1 }),
				{ expirationTtl: 600 },
			);
			return c.json({ error: "Invalid code" }, 400);
		}

		const existingUser = await c
			.get("db")
			.query<User>("SELECT * FROM users WHERE LOWER(email) = $1", [data.email]);
		if (existingUser.rows[0] && existingUser.rows[0].id !== user.id) {
			return c.json({ error: "Email already in use" }, 400);
		}

		await c
			.get("db")
			.query("UPDATE users SET email = $1 WHERE id = $2", [
				data.email,
				user.id,
			]);
		await invalidateUserSessionsCache(c, user.id);
		await c.env.OY2.delete(`${EMAIL_ADD_PREFIX}${user.id}`);

		const sessionToken = c.get("sessionToken");
		if (sessionToken) {
			const updatedUser = { ...user, email: data.email };
			await c.env.OY2.put(
				`session:${sessionToken}`,
				JSON.stringify(updatedUser),
				{ expirationTtl: 60 * 60 },
			);
			c.set("user", updatedUser);
		}

		return c.json({ status: "email_updated", email: data.email });
	});

	// Get pending email info (for username selection screen)
	app.get("/api/auth/email/pending", async (c: AppContext) => {
		const pendingId = getCookie(c, "email_pending");
		if (!pendingId) {
			return c.json({ error: "No pending email registration" }, 400);
		}

		const pendingData = await c.env.OY2.get(
			`${EMAIL_PENDING_PREFIX}${pendingId}`,
		);
		if (!pendingData) {
			return c.json({ error: "Email session expired" }, 400);
		}

		const { email } = JSON.parse(pendingData) as { email: string };

		return c.json({ provider: "email", email });
	});
}
