import type {
	AuthenticationResponseJSON,
	RegistrationResponseJSON,
	WebAuthnCredential,
} from "@simplewebauthn/server";
import { setCookie } from "hono/cookie";
import { authUserPayload, createSession, updateLastSeen } from "../lib";
import type { App, AppContext, Passkey, User } from "../types";

const CHALLENGE_PREFIX = "webauthn_challenge:";
const loadWebAuthn = () => import("@simplewebauthn/server");

function getOrigin(c: AppContext): string {
	const forwardedProto = c.req.header("X-Forwarded-Proto");
	const forwardedHost = c.req.header("X-Forwarded-Host");
	if (forwardedProto && forwardedHost) {
		return `${forwardedProto}://${forwardedHost}`;
	}

	const originHeader = c.req.header("Origin");
	if (originHeader) {
		return originHeader;
	}

	const referer = c.req.header("Referer");
	if (referer) {
		return new URL(referer).origin;
	}

	const url = new URL(c.req.url);
	return url.origin;
}

function getExpectedOrigins(c: AppContext): string | string[] {
	const originEnv = c.env.WEBAUTHN_ORIGIN;
	if (!originEnv) {
		return getOrigin(c);
	}
	const origins = originEnv
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
	if (origins.length === 1) {
		return origins[0];
	}
	return origins;
}

function getPrimaryOrigin(c: AppContext): string {
	const origins = getExpectedOrigins(c);
	return Array.isArray(origins) ? origins[0] : origins;
}

function getRpId(c: AppContext): string {
	return c.env.WEBAUTHN_RP_ID || new URL(getPrimaryOrigin(c)).hostname;
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

function base64UrlToUint8Array(value: string): Uint8Array {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const padding = "=".repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(base64 + padding);
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function base64UrlEncode(value: Uint8Array): string {
	return btoa(String.fromCharCode(...value))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export function registerPasskeyRoutes(app: App) {
	// Get registration options
	app.post("/api/auth/passkey/register/options", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		// Get existing passkeys to exclude
		const existingPasskeys = await c
			.get("db")
			.query<{ credential_id: Uint8Array }>(
				"SELECT credential_id FROM passkeys WHERE user_id = $1",
				[user.id],
			);

		const { generateRegistrationOptions } = await loadWebAuthn();
		const options = await generateRegistrationOptions({
			rpName: c.env.RP_NAME,
			rpID: getRpId(c),
			userID: new TextEncoder().encode(String(user.id)),
			userName: user.username,
			userDisplayName: user.username,
			timeout: 300000,
			attestationType: "none",
			authenticatorSelection: {
				residentKey: "required",
				userVerification: "preferred",
			},
			excludeCredentials: existingPasskeys.rows.map((passkey) => ({
				id: base64UrlEncode(new Uint8Array(passkey.credential_id)),
			})),
		});

		await c.env.OY2.put(
			`${CHALLENGE_PREFIX}register:${user.id}`,
			options.challenge,
			{ expirationTtl: 300 },
		);

		return c.json(options);
	});

	// Verify registration
	app.post("/api/auth/passkey/register/verify", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const { credential, deviceName } = (await c.req.json()) as {
			credential: RegistrationResponseJSON;
			deviceName?: string;
		};

		// Verify challenge
		const storedChallenge = await c.env.OY2.get(
			`${CHALLENGE_PREFIX}register:${user.id}`,
		);
		if (!storedChallenge) {
			return c.json({ error: "Challenge expired" }, 400);
		}
		await c.env.OY2.delete(`${CHALLENGE_PREFIX}register:${user.id}`);

		const expectedOrigin = getExpectedOrigins(c);
		const expectedRPID = getRpId(c);

		if (credential.type !== "public-key") {
			return c.json({ error: "Invalid credential type" }, 400);
		}

		const { verifyRegistrationResponse } = await loadWebAuthn();
		let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
		try {
			verification = await verifyRegistrationResponse({
				response: credential,
				expectedChallenge: storedChallenge,
				expectedOrigin,
				expectedRPID,
				requireUserVerification: false,
			});
		} catch {
			return c.json({ error: "Registration failed" }, 400);
		}

		if (!verification.verified || !verification.registrationInfo) {
			return c.json({ error: "Registration failed" }, 400);
		}

		const { credential: registeredCredential } = verification.registrationInfo;
		const transports = credential.response.transports || ["internal"];

		const credentialPublicKey =
			registeredCredential.publicKey instanceof Uint8Array
				? registeredCredential.publicKey
				: new Uint8Array(registeredCredential.publicKey);

		await c.get("db").query(
			`INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, device_name)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			[
				user.id,
				Buffer.from(base64UrlToUint8Array(registeredCredential.id)),
				Buffer.from(credentialPublicKey),
				registeredCredential.counter,
				transports,
				deviceName || null,
			],
		);

		return c.json({ success: true });
	});

	// Get authentication options (for zero-click or manual login)
	app.post("/api/auth/passkey/auth/options", async (c: AppContext) => {
		const authId = crypto.randomUUID();
		const { generateAuthenticationOptions } = await loadWebAuthn();
		const options = await generateAuthenticationOptions({
			rpID: getRpId(c),
			timeout: 300000,
			userVerification: "preferred",
			allowCredentials: [],
		});

		await c.env.OY2.put(
			`${CHALLENGE_PREFIX}auth:${authId}`,
			options.challenge,
			{
				expirationTtl: 300,
			},
		);

		return c.json({ authId, ...options });
	});

	// Verify authentication
	app.post("/api/auth/passkey/auth/verify", async (c: AppContext) => {
		const { authId, credential } = (await c.req.json()) as {
			authId: string;
			credential: AuthenticationResponseJSON;
		};

		// Verify challenge
		const storedChallenge = await c.env.OY2.get(
			`${CHALLENGE_PREFIX}auth:${authId}`,
		);
		if (!storedChallenge) {
			return c.json({ error: "Challenge expired" }, 400);
		}
		await c.env.OY2.delete(`${CHALLENGE_PREFIX}auth:${authId}`);

		// Decode credential ID
		const credentialId = base64UrlToUint8Array(credential.rawId);

		// Find passkey in database
		const passkeyResult = await c
			.get("db")
			.query<Passkey & { username: string }>(
				`SELECT p.*, u.username FROM passkeys p
			 JOIN users u ON u.id = p.user_id
			 WHERE p.credential_id = $1`,
				[Buffer.from(credentialId)],
			);

		if (passkeyResult.rows.length === 0) {
			return c.json({ error: "Unknown credential" }, 400);
		}

		const passkey = passkeyResult.rows[0];

		const expectedOrigin = getExpectedOrigins(c);
		const expectedRPID = getRpId(c);

		const { verifyAuthenticationResponse } = await loadWebAuthn();
		let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
		try {
			verification = await verifyAuthenticationResponse({
				response: credential,
				expectedChallenge: storedChallenge,
				expectedOrigin,
				expectedRPID,
				requireUserVerification: false,
				credential: {
					id: base64UrlEncode(new Uint8Array(passkey.credential_id)),
					publicKey: new Uint8Array(passkey.public_key),
					counter: passkey.counter,
				} satisfies WebAuthnCredential,
			});
		} catch {
			return c.json({ error: "Invalid signature" }, 400);
		}

		if (!verification.verified) {
			return c.json({ error: "Invalid signature" }, 400);
		}

		await c
			.get("db")
			.query("UPDATE passkeys SET counter = $1 WHERE id = $2", [
				verification.authenticationInfo.newCounter,
				passkey.id,
			]);

		// Get user
		const userResult = await c
			.get("db")
			.query<User>("SELECT * FROM users WHERE id = $1", [passkey.user_id]);

		if (userResult.rows.length === 0) {
			return c.json({ error: "User not found" }, 400);
		}

		const user = userResult.rows[0];

		// Create session
		const sessionToken = await createSession(c, user);
		setSessionCookie(c, sessionToken);
		c.executionCtx.waitUntil(
			c
				.get("db")
				.query(
					"UPDATE passkeys SET last_used_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = $1",
					[passkey.id],
				),
		);
		updateLastSeen(c, user.id);

		return c.json({
			user: authUserPayload(user),
		});
	});

	// Check if user has passkeys
	app.get("/api/auth/passkey/status", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ hasPasskey: false });
		}

		const passkeys = await c.get("db").query<{
			id: number;
			device_name: string | null;
			created_at: number;
			last_used_at: number | null;
		}>(
			"SELECT id, device_name, created_at, last_used_at FROM passkeys WHERE user_id = $1",
			[user.id],
		);

		return c.json({
			hasPasskey: passkeys.rows.length > 0,
			passkeys: passkeys.rows,
		});
	});

	// Delete a passkey
	app.delete("/api/auth/passkey/:id", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const passkeyId = parseInt(c.req.param("id"), 10);

		// Verify ownership
		const result = await c
			.get("db")
			.query("DELETE FROM passkeys WHERE id = $1 AND user_id = $2", [
				passkeyId,
				user.id,
			]);

		if (result.rowCount === 0) {
			return c.json({ error: "Passkey not found" }, 404);
		}

		return c.json({ success: true });
	});
}
