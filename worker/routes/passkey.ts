import { setCookie } from "hono/cookie";
import { authUserPayload, createSession, updateLastSeen } from "../lib";
import type { App, AppContext, Passkey, User } from "../types";

const CHALLENGE_PREFIX = "webauthn_challenge:";

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

// Get RP ID from the request origin (hostname without port)
function getRpId(c: AppContext): string {
	return new URL(getOrigin(c)).hostname;
}

function setSessionCookie(c: AppContext, token: string) {
	const url = new URL(c.req.url);
	const isSecure = url.protocol === "https:";
	setCookie(c, "session", token, {
		httpOnly: true,
		secure: isSecure,
		sameSite: isSecure ? "Strict" : "Lax",
		path: "/",
		maxAge: 60 * 60 * 24 * 365,
	});
}

async function generateChallenge(): Promise<Uint8Array> {
	const challenge = new Uint8Array(32);
	crypto.getRandomValues(challenge);
	return challenge;
}

function base64UrlEncode(data: Uint8Array): string {
	return btoa(String.fromCharCode(...data))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
	const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
	const padding = "=".repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(base64 + padding);
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function verifyRpIdHash(
	c: AppContext,
	authData: Uint8Array,
): Promise<boolean> {
	const rpId = getRpId(c);
	const rpIdHash = authData.slice(0, 32);
	const rpIdDigest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)),
	);
	for (let i = 0; i < rpIdHash.length; i += 1) {
		if (rpIdHash[i] !== rpIdDigest[i]) {
			return false;
		}
	}
	return true;
}

// Parse CBOR-encoded COSE public key (simplified for ES256)
function parseCoseKey(
	coseKey: Uint8Array,
): { x: Uint8Array; y: Uint8Array } | null {
	try {
		// This is a simplified CBOR parser for COSE_Key
		// In production, use a proper CBOR library
		// For ES256 keys, we extract the x and y coordinates

		// Find the -2 (x) and -3 (y) keys in the CBOR map
		// CBOR encoding: map with keys 1, 3, -1, -2, -3
		let i = 0;
		const map: Record<number, Uint8Array> = {};

		// Skip map header (assuming small map, 0xa5 = map of 5 items)
		if (coseKey[i] === 0xa5) {
			i++;
			for (let j = 0; j < 5; j++) {
				// Read key (negative int or positive int)
				let key: number;
				if (coseKey[i] === 0x01) {
					key = 1;
					i++;
				} else if (coseKey[i] === 0x03) {
					key = 3;
					i++;
				} else if (coseKey[i] === 0x20) {
					key = -1;
					i++;
				} else if (coseKey[i] === 0x21) {
					key = -2;
					i++;
				} else if (coseKey[i] === 0x22) {
					key = -3;
					i++;
				} else {
					i++;
					key = 0;
				}

				// Read value
				if (coseKey[i] === 0x02) {
					i++;
					continue;
				} // kty = 2 (EC2)
				if (coseKey[i] === 0x26) {
					i++;
					continue;
				} // alg = -7 (ES256)
				if (coseKey[i] === 0x01) {
					i++;
					continue;
				} // crv = 1 (P-256)

				// Byte string (0x58 = 1-byte length prefix)
				if (coseKey[i] === 0x58) {
					i++;
					const len = coseKey[i++];
					map[key] = coseKey.slice(i, i + len);
					i += len;
				}
			}
		}

		const x = map[-2];
		const y = map[-3];

		if (!x || !y || x.length !== 32 || y.length !== 32) {
			return null;
		}

		return { x, y };
	} catch {
		return null;
	}
}

// Verify ES256 signature
async function verifySignature(
	publicKey: Uint8Array,
	signature: Uint8Array,
	data: Uint8Array,
): Promise<boolean> {
	try {
		const coords = parseCoseKey(publicKey);
		if (!coords) return false;

		// Build raw public key (0x04 || x || y)
		const rawKey = new Uint8Array(65);
		rawKey[0] = 0x04;
		rawKey.set(coords.x, 1);
		rawKey.set(coords.y, 33);

		const key = await crypto.subtle.importKey(
			"raw",
			rawKey,
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["verify"],
		);

		// Convert signature from DER to raw format if needed
		let rawSig = signature;
		if (signature[0] === 0x30) {
			// DER encoded, convert to raw
			rawSig = derToRaw(signature);
		}

		return await crypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			key,
			rawSig.buffer as ArrayBuffer,
			data.buffer as ArrayBuffer,
		);
	} catch {
		return false;
	}
}

function derToRaw(der: Uint8Array): Uint8Array {
	// Parse DER signature: 0x30 [len] 0x02 [r_len] [r] 0x02 [s_len] [s]
	let offset = 2; // Skip 0x30 and length

	// Read r
	if (der[offset++] !== 0x02) throw new Error("Invalid DER");
	const rLen = der[offset++];
	let r = der.slice(offset, offset + rLen);
	offset += rLen;

	// Read s
	if (der[offset++] !== 0x02) throw new Error("Invalid DER");
	const sLen = der[offset++];
	let s = der.slice(offset, offset + sLen);

	// Remove leading zeros and pad to 32 bytes
	while (r.length > 32 && r[0] === 0) r = r.slice(1);
	while (s.length > 32 && s[0] === 0) s = s.slice(1);

	const raw = new Uint8Array(64);
	raw.set(r, 32 - r.length);
	raw.set(s, 64 - s.length);

	return raw;
}

export function registerPasskeyRoutes(app: App) {
	// Get registration options
	app.post("/api/auth/passkey/register/options", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const challenge = await generateChallenge();
		const challengeB64 = base64UrlEncode(challenge);

		// Store challenge in KV with 5 min expiry
		await c.env.OY2.put(
			`${CHALLENGE_PREFIX}register:${user.id}`,
			challengeB64,
			{ expirationTtl: 300 },
		);

		// Get existing passkeys to exclude
		const existingPasskeys = await c
			.get("db")
			.query<{ credential_id: Uint8Array }>(
				"SELECT credential_id FROM passkeys WHERE user_id = $1",
				[user.id],
			);

		const excludeCredentials = existingPasskeys.rows.map((p) => ({
			type: "public-key" as const,
			id: base64UrlEncode(new Uint8Array(p.credential_id)),
		}));

		return c.json({
			challenge: challengeB64,
			rp: {
				name: c.env.RP_NAME,
				id: getRpId(c),
			},
			user: {
				id: base64UrlEncode(new TextEncoder().encode(String(user.id))),
				name: user.username,
				displayName: user.username,
			},
			pubKeyCredParams: [
				{ type: "public-key", alg: -7 }, // ES256
			],
			timeout: 300000,
			attestation: "none",
			authenticatorSelection: {
				residentKey: "required",
				userVerification: "preferred",
			},
			excludeCredentials,
		});
	});

	// Verify registration
	app.post("/api/auth/passkey/register/verify", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const { credential, deviceName } = await c.req.json();

		// Verify challenge
		const storedChallenge = await c.env.OY2.get(
			`${CHALLENGE_PREFIX}register:${user.id}`,
		);
		if (!storedChallenge) {
			return c.json({ error: "Challenge expired" }, 400);
		}
		await c.env.OY2.delete(`${CHALLENGE_PREFIX}register:${user.id}`);

		const { response: authResponse, type } = credential;

		if (type !== "public-key") {
			return c.json({ error: "Invalid credential type" }, 400);
		}

		// Decode attestation response
		const clientDataJSON = base64UrlDecode(authResponse.clientDataJSON);
		const attestationObject = base64UrlDecode(authResponse.attestationObject);

		// Parse clientDataJSON
		const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));

		// Verify challenge matches
		if (clientData.challenge !== storedChallenge) {
			return c.json({ error: "Challenge mismatch" }, 400);
		}

		// Verify origin
		if (clientData.origin !== getOrigin(c)) {
			return c.json({ error: "Origin mismatch" }, 400);
		}

		// Verify type
		if (clientData.type !== "webauthn.create") {
			return c.json({ error: "Invalid type" }, 400);
		}

		// Parse attestation object (simplified CBOR parsing)
		// For "none" attestation, we just need the authData
		// authData format: rpIdHash (32) || flags (1) || signCount (4) || attestedCredentialData

		// Find authData in CBOR (look for "authData" key)
		const _attestationStr = new TextDecoder().decode(attestationObject);
		const authDataStart = attestationObject.indexOf(0x58); // byte string marker
		if (authDataStart === -1) {
			return c.json({ error: "Invalid attestation" }, 400);
		}

		// Skip to authData content (0x58 + length byte)
		const authDataOffset = authDataStart + 2;
		const authDataLen = attestationObject[authDataStart + 1];
		const authData = attestationObject.slice(
			authDataOffset,
			authDataOffset + authDataLen,
		);

		// Parse authData
		const flags = authData[32];
		const signCount =
			(authData[33] << 24) |
			(authData[34] << 16) |
			(authData[35] << 8) |
			authData[36];

		// Verify user presence (bit 0) and user verification (bit 2)
		if (!(flags & 0x01)) {
			return c.json({ error: "User presence not verified" }, 400);
		}

		if (!(await verifyRpIdHash(c, authData))) {
			return c.json({ error: "RP ID mismatch" }, 400);
		}

		// Extract attested credential data (if present, bit 6)
		if (!(flags & 0x40)) {
			return c.json({ error: "No credential data" }, 400);
		}

		const _aaguid = authData.slice(37, 53);
		const credIdLen = (authData[53] << 8) | authData[54];
		const credentialId = authData.slice(55, 55 + credIdLen);
		const publicKey = authData.slice(55 + credIdLen);

		// Store passkey
		const transports = authResponse.transports || ["internal"];

		await c.get("db").query(
			`INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, device_name)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			[
				user.id,
				Buffer.from(credentialId),
				Buffer.from(publicKey),
				signCount,
				transports,
				deviceName || null,
			],
		);

		return c.json({ success: true });
	});

	// Get authentication options (for zero-click or manual login)
	app.post("/api/auth/passkey/auth/options", async (c: AppContext) => {
		const challenge = await generateChallenge();
		const challengeB64 = base64UrlEncode(challenge);

		// Generate a temporary ID for this auth attempt
		const authId = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));

		// Store challenge
		await c.env.OY2.put(`${CHALLENGE_PREFIX}auth:${authId}`, challengeB64, {
			expirationTtl: 300,
		});

		return c.json({
			authId,
			challenge: challengeB64,
			rpId: getRpId(c),
			timeout: 300000,
			userVerification: "preferred",
			// Empty allowCredentials for discoverable credentials (zero-click)
			allowCredentials: [],
		});
	});

	// Verify authentication
	app.post("/api/auth/passkey/auth/verify", async (c: AppContext) => {
		const { authId, credential } = await c.req.json();

		// Verify challenge
		const storedChallenge = await c.env.OY2.get(
			`${CHALLENGE_PREFIX}auth:${authId}`,
		);
		if (!storedChallenge) {
			return c.json({ error: "Challenge expired" }, 400);
		}
		await c.env.OY2.delete(`${CHALLENGE_PREFIX}auth:${authId}`);

		const { id, response: authResponse, type } = credential;

		if (type !== "public-key") {
			return c.json({ error: "Invalid credential type" }, 400);
		}

		// Decode credential ID
		const credentialId = base64UrlDecode(id);

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

		// Decode response
		const clientDataJSON = base64UrlDecode(authResponse.clientDataJSON);
		const authenticatorData = base64UrlDecode(authResponse.authenticatorData);
		const signature = base64UrlDecode(authResponse.signature);

		// Parse clientDataJSON
		const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));

		// Verify challenge
		if (clientData.challenge !== storedChallenge) {
			return c.json({ error: "Challenge mismatch" }, 400);
		}

		// Verify origin
		if (clientData.origin !== getOrigin(c)) {
			return c.json({ error: "Origin mismatch" }, 400);
		}

		// Verify type
		if (clientData.type !== "webauthn.get") {
			return c.json({ error: "Invalid type" }, 400);
		}

		if (!(await verifyRpIdHash(c, authenticatorData))) {
			return c.json({ error: "RP ID mismatch" }, 400);
		}

		// Verify signature
		// signedData = authenticatorData || SHA-256(clientDataJSON)
		const clientDataHash = await crypto.subtle.digest(
			"SHA-256",
			clientDataJSON.buffer as ArrayBuffer,
		);
		const signedData = new Uint8Array(
			authenticatorData.length + clientDataHash.byteLength,
		);
		signedData.set(authenticatorData);
		signedData.set(new Uint8Array(clientDataHash), authenticatorData.length);

		const publicKey = new Uint8Array(passkey.public_key);
		const isValid = await verifySignature(publicKey, signature, signedData);

		if (!isValid) {
			return c.json({ error: "Invalid signature" }, 400);
		}

		// Verify counter (replay protection)
		const signCount =
			(authenticatorData[33] << 24) |
			(authenticatorData[34] << 16) |
			(authenticatorData[35] << 8) |
			authenticatorData[36];

		if (signCount <= passkey.counter && passkey.counter > 0) {
			// Possible cloned authenticator
			return c.json({ error: "Invalid counter" }, 400);
		}

		// Update counter for replay protection
		await c
			.get("db")
			.query("UPDATE passkeys SET counter = $1 WHERE id = $2", [
				signCount,
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
