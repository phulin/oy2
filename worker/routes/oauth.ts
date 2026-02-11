import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { authUserPayload, createSession, updateLastSeen } from "../lib";
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

// Verify Apple ID token
async function verifyAppleIdToken(
	idToken: string,
	expectedAudiences: string[],
): Promise<{ sub: string; email?: string } | null> {
	try {
		const parts = idToken.split(".");
		if (parts.length !== 3) {
			console.warn("[oauth][apple] invalid token format");
			return null;
		}

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

		if (!header.kid || header.alg !== "RS256") {
			console.warn("[oauth][apple] invalid token header", {
				kid: header.kid,
				alg: header.alg,
			});
			return null;
		}

		const jwksResponse = await fetch("https://appleid.apple.com/auth/keys");
		if (!jwksResponse.ok) {
			console.warn("[oauth][apple] failed to load jwks", {
				status: jwksResponse.status,
			});
			return null;
		}
		const jwks = (await jwksResponse.json()) as {
			keys?: Array<JsonWebKey & { kid?: string }>;
		};
		const jwk = jwks.keys?.find((key) => key.kid === header.kid);
		if (!jwk) {
			console.warn("[oauth][apple] kid not found in jwks", {
				kid: header.kid,
			});
			return null;
		}

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
		if (!valid) {
			console.warn("[oauth][apple] invalid signature");
			return null;
		}

		// Verify issuer and expiry
		if (payload.iss !== "https://appleid.apple.com") {
			console.warn("[oauth][apple] invalid issuer", { iss: payload.iss });
			return null;
		}
		if (!payload.exp || payload.exp < Date.now() / 1000) {
			console.warn("[oauth][apple] token expired", { exp: payload.exp });
			return null;
		}
		if (!payload.sub) {
			console.warn("[oauth][apple] missing sub");
			return null;
		}
		const aud = payload.aud;
		if (!aud) {
			console.warn("[oauth][apple] missing aud");
			return null;
		}
		if (Array.isArray(aud)) {
			if (!aud.some((value) => expectedAudiences.includes(value))) {
				console.warn("[oauth][apple] audience mismatch", {
					tokenAud: aud,
					expectedAudiences,
					sub: payload.sub,
				});
				return null;
			}
		} else if (!expectedAudiences.includes(aud)) {
			console.warn("[oauth][apple] audience mismatch", {
				tokenAud: aud,
				expectedAudiences,
				sub: payload.sub,
			});
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
		if (!response.ok) {
			console.warn("[oauth][google] tokeninfo request failed", {
				status: response.status,
			});
			return null;
		}

		const payload = (await response.json()) as {
			aud: string;
			sub: string;
			email?: string;
			name?: string;
		};

		// Verify audience
		if (payload.aud !== clientId) {
			console.warn("[oauth][google] audience mismatch", {
				tokenAud: payload.aud,
				expectedClientId: clientId,
				sub: payload.sub,
			});
			return null;
		}

		return { sub: payload.sub, email: payload.email, name: payload.name };
	} catch {
		return null;
	}
}

// Try to create or claim a user with the given username and OAuth credentials.
// Returns the user on success, or null if the username is taken.
async function tryCreateOAuthUser(
	c: AppContext,
	username: string,
	provider: string,
	sub: string,
	email: string | undefined,
): Promise<User | null> {
	const trimmed = username.trim().toLowerCase();
	if (!trimmed) return null;

	const existing = await c
		.get("db")
		.query<User>("SELECT * FROM users WHERE LOWER(username) = $1", [trimmed]);

	if (existing.rows.length > 0) {
		const existingUser = existing.rows[0];

		// Can't claim if already has OAuth or passkey
		if (existingUser.oauth_provider) return null;
		const passkeys = await c
			.get("db")
			.query("SELECT id FROM passkeys WHERE user_id = $1 LIMIT 1", [
				existingUser.id,
			]);
		if (passkeys.rows.length > 0) return null;

		// Claim the existing user by linking OAuth credentials
		await c.get("db").query(
			`UPDATE users SET oauth_provider = $1, oauth_sub = $2, email = COALESCE(email, $3)
			 WHERE id = $4`,
			[provider, sub, email || null, existingUser.id],
		);
		existingUser.oauth_provider = provider;
		existingUser.oauth_sub = sub;
		if (!existingUser.email && email) {
			existingUser.email = email;
		}
		return existingUser;
	}

	// Create new user
	const result = await c.get("db").query<User>(
		`INSERT INTO users (username, oauth_provider, oauth_sub, email)
		 VALUES ($1, $2, $3, $4)
		 RETURNING *`,
		[trimmed, provider, sub, email || null],
	);
	return result.rows[0];
}

export function registerOAuthRoutes(app: App) {
	const webAppleClientId = (c: AppContext) => c.env.APPLE_CLIENT_ID;
	const nativeAppleClientId = (c: AppContext) =>
		c.env.APPLE_NATIVE_CLIENT_ID || c.env.APPLE_CLIENT_ID;

	// Apple Sign-In redirect
	app.get("/api/auth/oauth/apple", async (c: AppContext) => {
		const state = await generateState();
		const origin = getOrigin(c);
		const signupUsername = c.req.query("username") || undefined;

		// Store state with provider and origin
		await c.env.OY2.put(
			`${OAUTH_STATE_PREFIX}${state}`,
			JSON.stringify({ provider: "apple", origin, username: signupUsername }),
			{ expirationTtl: 600 },
		);

		const params = new URLSearchParams({
			client_id: webAppleClientId(c),
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
		const signupUsername = c.req.query("username") || undefined;

		// Store state with provider, origin, and optional signup username
		await c.env.OY2.put(
			`${OAUTH_STATE_PREFIX}${state}`,
			JSON.stringify({ provider: "google", origin, username: signupUsername }),
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

		const {
			provider,
			origin,
			username: signupUsername,
		} = JSON.parse(stateData) as {
			provider: string;
			origin: string;
			username?: string;
		};

		let oauthSub: string;
		let email: string | undefined;
		let name: string | undefined;

		if (provider === "apple") {
			// Apple sends id_token directly in form_post
			if (!idToken) {
				return c.redirect("/?error=missing_token");
			}

			const verified = await verifyAppleIdToken(idToken, [webAppleClientId(c)]);
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

		// New user - if we have a pre-selected username from sign-up, try to create directly
		if (signupUsername) {
			const user = await tryCreateOAuthUser(
				c,
				signupUsername,
				provider,
				oauthSub,
				email,
			);
			if (user) {
				const sessionToken = await createSession(c, user);
				setSessionCookie(c, sessionToken);
				updateLastSeen(c, user.id);
				return c.redirect("/?passkey_setup=1");
			}
			// Username was taken (race condition) - fall through to choose_username
		}

		// Store pending OAuth data and redirect to username selection
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

		const {
			provider,
			origin,
			username: signupUsername,
		} = JSON.parse(stateData) as {
			provider: string;
			origin: string;
			username?: string;
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

		// New user - if we have a pre-selected username from sign-up, try to create directly
		if (signupUsername) {
			const user = await tryCreateOAuthUser(
				c,
				signupUsername,
				"google",
				verified.sub,
				verified.email,
			);
			if (user) {
				const sessionToken = await createSession(c, user);
				setSessionCookie(c, sessionToken);
				updateLastSeen(c, user.id);
				return c.redirect("/?passkey_setup=1");
			}
			// Username was taken (race condition) - fall through to choose_username
		}

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

	// Native Google Sign-In: return client ID for plugin initialization
	app.get("/api/auth/oauth/google/config", (c: AppContext) => {
		return c.json({ clientId: c.env.GOOGLE_CLIENT_ID });
	});

	// Native Apple Sign-In: return client ID for plugin initialization
	app.get("/api/auth/oauth/apple/config", (c: AppContext) => {
		return c.json({
			clientId: nativeAppleClientId(c),
		});
	});

	// Native Apple Sign-In: accept ID token directly (no redirect flow)
	app.post("/api/auth/oauth/apple/native", async (c: AppContext) => {
		const { idToken, username, name } = (await c.req.json()) as {
			idToken?: string;
			username?: string;
			name?: string;
		};

		if (!idToken) {
			return c.json({ error: "Missing idToken" }, 400);
		}

		const verified = await verifyAppleIdToken(idToken, [
			nativeAppleClientId(c),
		]);
		if (!verified) {
			return c.json({ error: "Invalid ID token" }, 401);
		}

		// Check if user already exists with this Apple identity
		const existingUser = await c
			.get("db")
			.query<User>(
				"SELECT * FROM users WHERE oauth_provider = $1 AND oauth_sub = $2",
				["apple", verified.sub],
			);

		if (existingUser.rows[0]) {
			const user = existingUser.rows[0];
			const sessionToken = await createSession(c, user);
			setSessionCookie(c, sessionToken);
			updateLastSeen(c, user.id);

			const passkeys = await c
				.get("db")
				.query("SELECT id FROM passkeys WHERE user_id = $1 LIMIT 1", [user.id]);

			return c.json({
				user: authUserPayload(user),
				needsPasskeySetup: passkeys.rows.length === 0,
			});
		}

		// New user with username provided — try to create
		if (username) {
			const user = await tryCreateOAuthUser(
				c,
				username,
				"apple",
				verified.sub,
				verified.email,
			);

			if (user) {
				const sessionToken = await createSession(c, user);
				setSessionCookie(c, sessionToken);
				updateLastSeen(c, user.id);
				return c.json({
					user: authUserPayload(user),
					needsPasskeySetup: true,
				});
			}

			return c.json({ error: "Username already taken" }, 409);
		}

		// New user, no username — store pending and let client handle username selection
		const pendingId = await generateState();
		await c.env.OY2.put(
			`${OAUTH_PENDING_PREFIX}${pendingId}`,
			JSON.stringify({
				provider: "apple",
				sub: verified.sub,
				email: verified.email,
				name,
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

		return c.json({ needsUsername: true });
	});

	// Native Google Sign-In: accept ID token directly (no redirect flow)
	app.post("/api/auth/oauth/google/native", async (c: AppContext) => {
		const { idToken, username } = (await c.req.json()) as {
			idToken?: string;
			username?: string;
		};

		if (!idToken) {
			return c.json({ error: "Missing idToken" }, 400);
		}

		const verified = await verifyGoogleIdToken(idToken, c.env.GOOGLE_CLIENT_ID);
		if (!verified) {
			return c.json({ error: "Invalid ID token" }, 401);
		}

		// Check if user already exists with this Google identity
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

			return c.json({
				user: authUserPayload(user),
				needsPasskeySetup: passkeys.rows.length === 0,
			});
		}

		// New user with username provided — try to create
		if (username) {
			const user = await tryCreateOAuthUser(
				c,
				username,
				"google",
				verified.sub,
				verified.email,
			);

			if (user) {
				const sessionToken = await createSession(c, user);
				setSessionCookie(c, sessionToken);
				updateLastSeen(c, user.id);
				return c.json({
					user: authUserPayload(user),
					needsPasskeySetup: true,
				});
			}

			return c.json({ error: "Username already taken" }, 409);
		}

		// New user, no username — store pending and let client handle username selection
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

		return c.json({ needsUsername: true });
	});
}
