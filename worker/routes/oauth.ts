import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
	authUserPayload,
	createSession,
	invalidateUserSessionsCache,
	updateLastSeen,
} from "../lib";
import type { App, AppContext, User } from "../types";

const OAUTH_STATE_PREFIX = "oauth_state:";
const OAUTH_PENDING_PREFIX = "oauth_pending:";

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

function setSessionCookie(c: AppContext, token: string) {
	setCookie(c, "session", token, {
		httpOnly: true,
		secure: true,
		sameSite: "Strict",
		path: "/",
		maxAge: 60 * 60 * 24 * 365,
	});
}

async function generateState(): Promise<string> {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64UrlDecodeString(value: string): string {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const padding = "=".repeat((4 - (base64.length % 4)) % 4);
	return atob(base64 + padding);
}

function base64UrlDecodeBytes(value: string): Uint8Array {
	const decoded = base64UrlDecodeString(value);
	const bytes = new Uint8Array(decoded.length);
	for (let i = 0; i < decoded.length; i += 1) {
		bytes[i] = decoded.charCodeAt(i);
	}
	return bytes;
}

// Apple Sign-In: Generate client_secret JWT
async function _generateAppleClientSecret(c: AppContext): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "ES256", kid: c.env.APPLE_KEY_ID };
	const payload = {
		iss: c.env.APPLE_TEAM_ID,
		iat: now,
		exp: now + 86400 * 180, // 6 months
		aud: "https://appleid.apple.com",
		sub: c.env.APPLE_CLIENT_ID,
	};

	const encodedHeader = btoa(JSON.stringify(header))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	const encodedPayload = btoa(JSON.stringify(payload))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	const signingInput = `${encodedHeader}.${encodedPayload}`;

	// Import Apple private key (PEM format)
	const pemContents = c.env.APPLE_PRIVATE_KEY.replace(
		/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g,
		"",
	);
	const keyData = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

	const key = await crypto.subtle.importKey(
		"pkcs8",
		keyData,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"],
	);

	const signature = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		new TextEncoder().encode(signingInput),
	);

	// Convert DER signature to raw format for JWT
	const sigArray = new Uint8Array(signature);
	const encodedSig = btoa(String.fromCharCode(...sigArray))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	return `${signingInput}.${encodedSig}`;
}

// Verify Apple ID token
async function verifyAppleIdToken(
	c: AppContext,
	idToken: string,
): Promise<{ sub: string; email?: string } | null> {
	try {
		const parts = idToken.split(".");
		if (parts.length !== 3) return null;

		const header = JSON.parse(base64UrlDecodeString(parts[0])) as {
			alg?: string;
			kid?: string;
		};
		const payload = JSON.parse(base64UrlDecodeString(parts[1])) as {
			iss?: string;
			exp?: number;
			sub?: string;
			email?: string;
			aud?: string | string[];
		};

		if (!header.kid || header.alg !== "RS256") return null;

		const jwksResponse = await fetch("https://appleid.apple.com/auth/keys");
		if (!jwksResponse.ok) return null;
		const jwks = (await jwksResponse.json()) as {
			keys?: Array<JsonWebKey & { kid?: string }>;
		};
		const jwk = jwks.keys?.find((key) => key.kid === header.kid);
		if (!jwk) return null;

		const key = await crypto.subtle.importKey(
			"jwk",
			jwk,
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
			false,
			["verify"],
		);

		const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
		const signature = base64UrlDecodeBytes(parts[2]);
		const signatureBuffer = signature.buffer as ArrayBuffer;
		const valid = await crypto.subtle.verify(
			"RSASSA-PKCS1-v1_5",
			key,
			signatureBuffer,
			signedData,
		);
		if (!valid) return null;

		// Verify issuer and expiry
		if (payload.iss !== "https://appleid.apple.com") return null;
		if (!payload.exp || payload.exp < Date.now() / 1000) return null;
		if (!payload.sub) return null;
		const aud = payload.aud;
		const clientId = c.env.APPLE_CLIENT_ID;
		if (Array.isArray(aud)) {
			if (!aud.includes(clientId)) return null;
		} else if (aud !== clientId) {
			return null;
		}

		return { sub: payload.sub, email: payload.email };
	} catch {
		return null;
	}
}

// Verify Google ID token
async function verifyGoogleIdToken(
	idToken: string,
	clientId: string,
): Promise<{ sub: string; email?: string; name?: string } | null> {
	try {
		// Use Google's tokeninfo endpoint for simplicity
		const response = await fetch(
			`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`,
		);
		if (!response.ok) return null;

		const payload = (await response.json()) as {
			aud: string;
			sub: string;
			email?: string;
			name?: string;
		};

		// Verify audience
		if (payload.aud !== clientId) return null;

		return { sub: payload.sub, email: payload.email, name: payload.name };
	} catch {
		return null;
	}
}

export function registerOAuthRoutes(app: App) {
	// Apple Sign-In redirect
	app.get("/api/auth/oauth/apple", async (c: AppContext) => {
		const state = await generateState();
		const origin = getOrigin(c);

		// Store state with provider and origin
		await c.env.OY2.put(
			`${OAUTH_STATE_PREFIX}${state}`,
			JSON.stringify({ provider: "apple", origin }),
			{ expirationTtl: 600 },
		);

		const params = new URLSearchParams({
			client_id: c.env.APPLE_CLIENT_ID,
			redirect_uri: `${origin}/api/auth/oauth/callback`,
			response_type: "code id_token",
			response_mode: "form_post",
			scope: "name email",
			state,
		});

		return c.redirect(
			`https://appleid.apple.com/auth/authorize?${params.toString()}`,
		);
	});

	// Google Sign-In redirect
	app.get("/api/auth/oauth/google", async (c: AppContext) => {
		const state = await generateState();
		const origin = getOrigin(c);

		// Store state with provider and origin
		await c.env.OY2.put(
			`${OAUTH_STATE_PREFIX}${state}`,
			JSON.stringify({ provider: "google", origin }),
			{ expirationTtl: 600 },
		);

		const params = new URLSearchParams({
			client_id: c.env.GOOGLE_CLIENT_ID,
			redirect_uri: `${origin}/api/auth/oauth/callback`,
			response_type: "code",
			scope: "openid email profile",
			state,
			access_type: "online",
			prompt: "select_account",
		});

		return c.redirect(
			`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
		);
	});

	// OAuth callback (handles both Apple and Google)
	app.post("/api/auth/oauth/callback", async (c: AppContext) => {
		const body = await c.req.parseBody();
		const state = body.state as string;
		const code = body.code as string;
		const idToken = body.id_token as string; // Apple sends this directly

		if (!state) {
			return c.redirect("/?error=missing_state");
		}

		// Verify and consume state
		const stateData = await c.env.OY2.get(`${OAUTH_STATE_PREFIX}${state}`);
		if (!stateData) {
			return c.redirect("/?error=invalid_state");
		}
		await c.env.OY2.delete(`${OAUTH_STATE_PREFIX}${state}`);

		const { provider, origin } = JSON.parse(stateData) as {
			provider: string;
			origin: string;
		};

		let oauthSub: string;
		let email: string | undefined;
		let name: string | undefined;

		if (provider === "apple") {
			// Apple sends id_token directly in form_post
			if (!idToken) {
				return c.redirect("/?error=missing_token");
			}

			const verified = await verifyAppleIdToken(c, idToken);
			if (!verified) {
				return c.redirect("/?error=invalid_token");
			}

			oauthSub = verified.sub;
			email = verified.email;

			// Apple sends user info only on first auth
			const userJson = body.user as string | undefined;
			if (userJson) {
				try {
					const userData = JSON.parse(userJson) as {
						name?: { firstName?: string; lastName?: string };
					};
					if (userData.name) {
						name = [userData.name.firstName, userData.name.lastName]
							.filter(Boolean)
							.join(" ");
					}
				} catch {
					// Ignore parse errors
				}
			}
		} else if (provider === "google") {
			if (!code) {
				return c.redirect("/?error=missing_code");
			}

			// Exchange code for tokens
			const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					code,
					client_id: c.env.GOOGLE_CLIENT_ID,
					client_secret: c.env.GOOGLE_CLIENT_SECRET,
					redirect_uri: `${origin}/api/auth/oauth/callback`,
					grant_type: "authorization_code",
				}),
			});

			if (!tokenResponse.ok) {
				return c.redirect("/?error=token_exchange_failed");
			}

			const tokens = (await tokenResponse.json()) as { id_token?: string };
			if (!tokens.id_token) {
				return c.redirect("/?error=missing_id_token");
			}

			const verified = await verifyGoogleIdToken(
				tokens.id_token,
				c.env.GOOGLE_CLIENT_ID,
			);
			if (!verified) {
				return c.redirect("/?error=invalid_token");
			}

			oauthSub = verified.sub;
			email = verified.email;
			name = verified.name;
		} else {
			return c.redirect("/?error=unknown_provider");
		}

		// Check if user exists with this OAuth identity
		const existingUser = await c
			.get("db")
			.query<User>(
				"SELECT * FROM users WHERE oauth_provider = $1 AND oauth_sub = $2",
				[provider, oauthSub],
			);

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

			if (passkeys.rows.length === 0) {
				return c.redirect("/?passkey_setup=1");
			}

			return c.redirect("/");
		}

		// New user - store pending OAuth data and redirect to username selection
		const pendingId = await generateState();
		await c.env.OY2.put(
			`${OAUTH_PENDING_PREFIX}${pendingId}`,
			JSON.stringify({ provider, sub: oauthSub, email, name }),
			{ expirationTtl: 600 },
		);

		setCookie(c, "oauth_pending", pendingId, {
			httpOnly: true,
			secure: true,
			sameSite: "Strict",
			path: "/",
			maxAge: 600,
		});

		return c.redirect("/?choose_username=1");
	});

	// Also handle GET for Google (it uses GET redirect)
	app.get("/api/auth/oauth/callback", async (c: AppContext) => {
		const state = c.req.query("state");
		const code = c.req.query("code");
		const error = c.req.query("error");

		if (error) {
			return c.redirect(`/?error=${error}`);
		}

		if (!state || !code) {
			return c.redirect("/?error=missing_params");
		}

		// Verify and consume state
		const stateData = await c.env.OY2.get(`${OAUTH_STATE_PREFIX}${state}`);
		if (!stateData) {
			return c.redirect("/?error=invalid_state");
		}
		await c.env.OY2.delete(`${OAUTH_STATE_PREFIX}${state}`);

		const { provider, origin } = JSON.parse(stateData) as {
			provider: string;
			origin: string;
		};

		if (provider !== "google") {
			return c.redirect("/?error=invalid_state");
		}

		// Exchange code for tokens
		const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code,
				client_id: c.env.GOOGLE_CLIENT_ID,
				client_secret: c.env.GOOGLE_CLIENT_SECRET,
				redirect_uri: `${origin}/api/auth/oauth/callback`,
				grant_type: "authorization_code",
			}),
		});

		if (!tokenResponse.ok) {
			return c.redirect("/?error=token_exchange_failed");
		}

		const tokens = (await tokenResponse.json()) as { id_token?: string };
		if (!tokens.id_token) {
			return c.redirect("/?error=missing_id_token");
		}

		const verified = await verifyGoogleIdToken(
			tokens.id_token,
			c.env.GOOGLE_CLIENT_ID,
		);
		if (!verified) {
			return c.redirect("/?error=invalid_token");
		}

		// Check if user exists
		const existingUser = await c
			.get("db")
			.query<User>(
				"SELECT * FROM users WHERE oauth_provider = $1 AND oauth_sub = $2",
				["google", verified.sub],
			);

		if (existingUser.rows[0]) {
			const user = existingUser.rows[0];
			const sessionToken = await createSession(c, user);
			setSessionCookie(c, sessionToken);
			updateLastSeen(c, user.id);

			const passkeys = await c
				.get("db")
				.query("SELECT id FROM passkeys WHERE user_id = $1 LIMIT 1", [user.id]);

			if (passkeys.rows.length === 0) {
				return c.redirect("/?passkey_setup=1");
			}

			return c.redirect("/");
		}

		// New user
		const pendingId = await generateState();
		await c.env.OY2.put(
			`${OAUTH_PENDING_PREFIX}${pendingId}`,
			JSON.stringify({
				provider: "google",
				sub: verified.sub,
				email: verified.email,
				name: verified.name,
			}),
			{ expirationTtl: 600 },
		);

		setCookie(c, "oauth_pending", pendingId, {
			httpOnly: true,
			secure: true,
			sameSite: "Strict",
			path: "/",
			maxAge: 600,
		});

		return c.redirect("/?choose_username=1");
	});

	// Complete registration with username
	app.post("/api/auth/oauth/complete", async (c: AppContext) => {
		const pendingId = getCookie(c, "oauth_pending");
		if (!pendingId) {
			return c.json({ error: "No pending OAuth registration" }, 400);
		}

		const pendingData = await c.env.OY2.get(
			`${OAUTH_PENDING_PREFIX}${pendingId}`,
		);
		if (!pendingData) {
			return c.json({ error: "OAuth session expired" }, 400);
		}

		const { provider, sub, email } = JSON.parse(pendingData) as {
			provider: string;
			sub: string;
			email?: string;
		};

		const { username } = await c.req.json();
		const trimmedUsername = String(username || "")
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

			// If user already has OAuth linked, they can't claim it
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

			// Claim the existing user by linking OAuth credentials
			await c.get("db").query(
				`UPDATE users SET oauth_provider = $1, oauth_sub = $2, email = COALESCE(email, $3)
				 WHERE id = $4`,
				[provider, sub, email || null, existingUser.id],
			);
			await invalidateUserSessionsCache(c, existingUser.id);
			existingUser.oauth_provider = provider;
			existingUser.oauth_sub = sub;
			if (!existingUser.email && email) {
				existingUser.email = email;
			}

			// Clean up pending data
			await c.env.OY2.delete(`${OAUTH_PENDING_PREFIX}${pendingId}`);
			deleteCookie(c, "oauth_pending", { path: "/" });

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
			`INSERT INTO users (username, oauth_provider, oauth_sub, email)
			 VALUES ($1, $2, $3, $4)
			 RETURNING *`,
			[trimmedUsername, provider, sub, email || null],
		);

		const user = result.rows[0];

		// Clean up pending data
		await c.env.OY2.delete(`${OAUTH_PENDING_PREFIX}${pendingId}`);
		deleteCookie(c, "oauth_pending", { path: "/" });

		// Create session
		const sessionToken = await createSession(c, user);
		setSessionCookie(c, sessionToken);
		updateLastSeen(c, user.id);

		return c.json({
			user: authUserPayload(user),
			needsPasskeySetup: true,
		});
	});

	// Get pending OAuth info (for username selection screen)
	app.get("/api/auth/oauth/pending", async (c: AppContext) => {
		const pendingId = getCookie(c, "oauth_pending");
		if (!pendingId) {
			return c.json({ error: "No pending OAuth registration" }, 400);
		}

		const pendingData = await c.env.OY2.get(
			`${OAUTH_PENDING_PREFIX}${pendingId}`,
		);
		if (!pendingData) {
			return c.json({ error: "OAuth session expired" }, 400);
		}

		const { provider, email, name } = JSON.parse(pendingData) as {
			provider: string;
			email?: string;
			name?: string;
		};

		return c.json({ provider, email, name });
	});
}
