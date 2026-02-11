import type { PushMessage } from "@block65/webcrypto-web-push";
import type { Bindings, PushPayload } from "./types";

const DEFAULT_VAPID_SUBJECT = "mailto:admin@example.com";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const APNS_PRODUCTION_HOST = "https://api.push.apple.com";
const APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com";
const NATIVE_PUSH_SOUND_FILE = "oy.wav";
const ANDROID_NATIVE_PUSH_SOUND = "oy";
const ANDROID_PUSH_CHANNEL_ID = "oy_notifications_v1";

type PushSendError = Error & {
	statusCode?: number;
	permanent?: boolean;
};

export type ProviderHealth = {
	configured: boolean;
	ok: boolean;
	error?: string;
};

type NativePushOptions = {
	requestUrl?: string;
	apnsUseSandbox?: boolean;
	apnsEnvironment?: "sandbox" | "production";
};

let cachedFcmAccessToken: {
	accessToken: string;
	expiresAtEpochSeconds: number;
} | null = null;

let cachedApnsJwt: {
	token: string;
	expiresAtEpochSeconds: number;
} | null = null;

function base64UrlEncode(buffer: Uint8Array) {
	return Buffer.from(buffer)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const padding =
		base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
	return Buffer.from(base64 + padding, "base64");
}

function normalizePem(value: string) {
	return value.replace(/\\n/g, "\n").trim();
}

function pemToArrayBuffer(pem: string) {
	const normalized = normalizePem(pem);
	const body = normalized
		.replace(/-----BEGIN [^-]+-----/g, "")
		.replace(/-----END [^-]+-----/g, "")
		.replace(/\s+/g, "");
	return base64UrlDecode(base64UrlEncode(Buffer.from(body, "base64")));
}

function toJoseEcdsaSignature(signature: Uint8Array, componentBytes = 32) {
	if (signature.length === componentBytes * 2) {
		return signature;
	}
	if (signature.length < 8 || signature[0] !== 0x30) {
		throw new Error("Invalid ECDSA signature format");
	}

	let offset = 1;
	const seqLen = signature[offset];
	offset += 1;
	if (seqLen + 2 !== signature.length) {
		throw new Error("Unsupported DER signature length");
	}
	if (signature[offset] !== 0x02) {
		throw new Error("Invalid DER signature (missing r)");
	}
	offset += 1;
	const rLen = signature[offset];
	offset += 1;
	const r = signature.slice(offset, offset + rLen);
	offset += rLen;
	if (signature[offset] !== 0x02) {
		throw new Error("Invalid DER signature (missing s)");
	}
	offset += 1;
	const sLen = signature[offset];
	offset += 1;
	const s = signature.slice(offset, offset + sLen);

	const out = new Uint8Array(componentBytes * 2);
	out.set(
		r.slice(Math.max(0, r.length - componentBytes)),
		componentBytes - Math.min(componentBytes, r.length),
	);
	out.set(
		s.slice(Math.max(0, s.length - componentBytes)),
		componentBytes * 2 - Math.min(componentBytes, s.length),
	);
	return out;
}

function makePushError(
	message: string,
	statusCode?: number,
	permanent = false,
): PushSendError {
	const err = new Error(message) as PushSendError;
	err.statusCode = statusCode;
	err.permanent = permanent;
	return err;
}

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value === "object" && value !== null) {
		return value as Record<string, unknown>;
	}
	return {};
}

export function resolveApnsUseSandbox(
	apnsUseSandboxValue: string | undefined,
	requestUrl?: string,
) {
	const normalized = (apnsUseSandboxValue ?? "").trim().toLowerCase();
	if (normalized === "true" || normalized === "1") {
		return true;
	}
	if (normalized === "false" || normalized === "0") {
		return false;
	}
	if (!requestUrl) {
		return false;
	}
	try {
		const hostname = new URL(requestUrl).hostname.toLowerCase();
		return hostname === "localhost" || hostname === "127.0.0.1";
	} catch {
		return false;
	}
}

async function createJwt({
	header,
	payload,
	privateKeyPem,
	algorithm,
}: {
	header: Record<string, unknown>;
	payload: Record<string, unknown>;
	privateKeyPem: string;
	algorithm: "RSASSA-PKCS1-v1_5" | "ECDSA";
}) {
	const enc = new TextEncoder();
	const encodedHeader = base64UrlEncode(enc.encode(JSON.stringify(header)));
	const encodedPayload = base64UrlEncode(enc.encode(JSON.stringify(payload)));
	const signingInput = `${encodedHeader}.${encodedPayload}`;
	const keyData = pemToArrayBuffer(privateKeyPem);
	const key = await crypto.subtle.importKey(
		"pkcs8",
		keyData,
		algorithm === "RSASSA-PKCS1-v1_5"
			? {
					name: "RSASSA-PKCS1-v1_5",
					hash: "SHA-256",
				}
			: {
					name: "ECDSA",
					namedCurve: "P-256",
				},
		false,
		["sign"],
	);
	const rawSignature = new Uint8Array(
		await crypto.subtle.sign(
			algorithm === "RSASSA-PKCS1-v1_5"
				? "RSASSA-PKCS1-v1_5"
				: { name: "ECDSA", hash: "SHA-256" },
			key,
			enc.encode(signingInput),
		),
	);
	const signature =
		algorithm === "ECDSA" ? toJoseEcdsaSignature(rawSignature) : rawSignature;
	return `${signingInput}.${base64UrlEncode(signature)}`;
}

function getFcmConfig(env: Bindings) {
	if (env.FCM_SERVICE_ACCOUNT_JSON) {
		const parsed = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON) as {
			project_id?: string;
			client_email?: string;
			private_key?: string;
		};
		return {
			projectId: parsed.project_id ?? "",
			clientEmail: parsed.client_email ?? "",
			privateKey: parsed.private_key ?? "",
		};
	}
	return {
		projectId: env.FCM_PROJECT_ID ?? "",
		clientEmail: env.FCM_CLIENT_EMAIL ?? "",
		privateKey: env.FCM_PRIVATE_KEY ?? "",
	};
}

function isFcmConfigured(env: Bindings) {
	const config = getFcmConfig(env);
	return Boolean(config.projectId && config.clientEmail && config.privateKey);
}

async function getFcmAccessToken(env: Bindings) {
	const now = Math.floor(Date.now() / 1000);
	if (
		cachedFcmAccessToken &&
		cachedFcmAccessToken.expiresAtEpochSeconds - 60 > now
	) {
		return cachedFcmAccessToken.accessToken;
	}

	const config = getFcmConfig(env);
	if (!config.projectId || !config.clientEmail || !config.privateKey) {
		throw makePushError(
			"FCM not configured (missing project/client/private key)",
		);
	}

	const jwt = await createJwt({
		header: { alg: "RS256", typ: "JWT" },
		payload: {
			iss: config.clientEmail,
			sub: config.clientEmail,
			aud: GOOGLE_TOKEN_ENDPOINT,
			scope: FCM_SCOPE,
			iat: now,
			exp: now + 3600,
		},
		privateKeyPem: config.privateKey,
		algorithm: "RSASSA-PKCS1-v1_5",
	});

	const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: jwt,
		}),
	});
	const body = asRecord(await response.json().catch(() => ({})));
	const accessToken =
		typeof body.access_token === "string" ? body.access_token : null;
	if (!response.ok || !accessToken) {
		throw makePushError(
			`Failed to acquire FCM access token (${response.status})`,
			response.status,
		);
	}
	const expiresIn =
		typeof body.expires_in === "number" ? body.expires_in : 3600;
	cachedFcmAccessToken = {
		accessToken,
		expiresAtEpochSeconds: now + expiresIn,
	};
	return accessToken;
}

function payloadData(payload: PushPayload) {
	const data: Record<string, string> = {};
	const entries = Object.entries(payload);
	for (const [key, value] of entries) {
		if (value === undefined || value === null) {
			continue;
		}
		data[key] = String(value);
	}
	return data;
}

async function sendAndroidPushNotification(
	env: Bindings,
	token: string,
	payload: PushPayload,
) {
	const accessToken = await getFcmAccessToken(env);
	const { projectId } = getFcmConfig(env);
	const response = await fetch(
		`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				message: {
					token,
					notification: {
						title: payload.title,
						body: payload.body,
					},
					data: payloadData(payload),
					android: {
						priority: "high",
						notification: {
							channel_id: ANDROID_PUSH_CHANNEL_ID,
							sound: ANDROID_NATIVE_PUSH_SOUND,
						},
					},
				},
			}),
		},
	);
	if (!response.ok) {
		const body = asRecord(await response.json().catch(() => ({})));
		const errorBody = asRecord(body.error);
		const details = Array.isArray(errorBody.details)
			? (errorBody.details as Array<{ errorCode?: string }>)
			: [];
		const errorCode =
			details.find((detail) => detail.errorCode)?.errorCode ??
			(typeof errorBody.status === "string" ? errorBody.status : undefined);
		const permanent = errorCode === "UNREGISTERED";
		throw makePushError(
			`FCM push failed (${response.status}) ${errorCode ?? ""}`.trim(),
			response.status,
			permanent,
		);
	}
	response.body?.cancel();
	return response;
}

function getApnsConfig(env: Bindings, options?: NativePushOptions) {
	const useSandboxFromEnvironment =
		options?.apnsEnvironment === undefined
			? undefined
			: options.apnsEnvironment === "sandbox";
	return {
		keyId: env.APPLE_KEY_ID ?? "",
		teamId: env.APPLE_TEAM_ID ?? "",
		privateKey: env.APPLE_PRIVATE_KEY ?? "",
		bundleId: env.APPLE_NATIVE_CLIENT_ID ?? env.APPLE_CLIENT_ID ?? "",
		useSandbox:
			options?.apnsUseSandbox ??
			useSandboxFromEnvironment ??
			resolveApnsUseSandbox(env.APNS_USE_SANDBOX, options?.requestUrl),
	};
}

function isApnsConfigured(env: Bindings, options?: NativePushOptions) {
	const config = getApnsConfig(env, options);
	return Boolean(
		config.keyId && config.teamId && config.privateKey && config.bundleId,
	);
}

async function getApnsJwt(env: Bindings, options?: NativePushOptions) {
	const now = Math.floor(Date.now() / 1000);
	if (cachedApnsJwt && cachedApnsJwt.expiresAtEpochSeconds - 60 > now) {
		return cachedApnsJwt.token;
	}
	const config = getApnsConfig(env, options);
	if (
		!config.keyId ||
		!config.teamId ||
		!config.privateKey ||
		!config.bundleId
	) {
		throw makePushError(
			"APNs not configured (missing APPLE_* key/team/private key/topic)",
		);
	}
	const token = await createJwt({
		header: {
			alg: "ES256",
			kid: config.keyId,
		},
		payload: {
			iss: config.teamId,
			iat: now,
		},
		privateKeyPem: config.privateKey,
		algorithm: "ECDSA",
	});
	cachedApnsJwt = { token, expiresAtEpochSeconds: now + 50 * 60 };
	return token;
}

async function sendIosPushNotification(
	env: Bindings,
	token: string,
	payload: PushPayload,
	options?: NativePushOptions,
) {
	const config = getApnsConfig(env, options);
	const jwt = await getApnsJwt(env, options);
	const host = config.useSandbox ? APNS_SANDBOX_HOST : APNS_PRODUCTION_HOST;
	const response = await fetch(`${host}/3/device/${token}`, {
		method: "POST",
		headers: {
			authorization: `bearer ${jwt}`,
			"apns-topic": config.bundleId,
			"apns-push-type": "alert",
			"apns-priority": "10",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			aps: {
				alert: {
					title: payload.title,
					body: payload.body,
				},
				sound: NATIVE_PUSH_SOUND_FILE,
			},
			...payload,
		}),
	});
	if (!response.ok) {
		const body = asRecord(await response.json().catch(() => ({})));
		const reason =
			typeof body.reason === "string" ? body.reason : "UnknownReason";
		const permanentReasons = new Set([
			"BadDeviceToken",
			"DeviceTokenNotForTopic",
			"Unregistered",
		]);
		throw makePushError(
			`APNs push failed (${response.status}) ${reason}`,
			response.status,
			permanentReasons.has(reason),
		);
	}
	response.body?.cancel();
	return response;
}

export async function sendNativePushNotification(
	env: Bindings,
	platform: "ios" | "android",
	token: string,
	payload: PushPayload,
	options?: NativePushOptions,
) {
	if (platform === "android") {
		return sendAndroidPushNotification(env, token, payload);
	}
	return sendIosPushNotification(env, token, payload, options);
}

export async function checkNativePushHealth(env: Bindings): Promise<{
	fcm: ProviderHealth;
	apns: ProviderHealth;
}> {
	return checkNativePushHealthWithOptions(env);
}

export async function checkNativePushHealthWithOptions(
	env: Bindings,
	options?: NativePushOptions,
): Promise<{
	fcm: ProviderHealth;
	apns: ProviderHealth;
}> {
	const fcm: ProviderHealth = {
		configured: isFcmConfigured(env),
		ok: false,
	};
	const apns: ProviderHealth = {
		configured: isApnsConfigured(env, options),
		ok: false,
	};

	if (fcm.configured) {
		try {
			await getFcmAccessToken(env);
			fcm.ok = true;
		} catch (err) {
			fcm.error = err instanceof Error ? err.message : String(err);
		}
	}

	if (apns.configured) {
		try {
			await getApnsJwt(env, options);
			apns.ok = true;
		} catch (err) {
			apns.error = err instanceof Error ? err.message : String(err);
		}
	}

	return { fcm, apns };
}

/**
 * Send a web push notification to a subscription (Cloudflare Workers-compatible).
 */
export async function sendPushNotification(
	env: {
		VAPID_PUBLIC_KEY?: string;
		VAPID_PRIVATE_KEY?: string;
		VAPID_SUBJECT?: string;
	},
	subscription: {
		endpoint: string;
		expirationTime: number | null;
		keys: { p256dh: string; auth: string };
	},
	payload: PushMessage["data"],
) {
	const { buildPushPayload } = await import("@block65/webcrypto-web-push");
	if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
		throw new Error("VAPID keys not configured");
	}

	const vapid = {
		subject: env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT,
		publicKey: env.VAPID_PUBLIC_KEY,
		privateKey: env.VAPID_PRIVATE_KEY,
	};

	const message: PushMessage = {
		data: payload,
		options: {
			ttl: 3600,
		},
	};

	const request = await buildPushPayload(message, subscription, vapid);
	const res = await fetch(subscription.endpoint, {
		method: request.method,
		headers: request.headers,
		body: request.body as BodyInit,
	});

	if (!res.ok) {
		res.body?.cancel();
		const err = new Error(
			`Push failed with status ${res.status}`,
		) as PushSendError;
		err.statusCode = res.status;
		err.permanent = res.status === 410;
		throw err;
	}

	res.body?.cancel();
	return res;
}

/**
 * Generate VAPID keys for push notifications.
 */
export async function generateVAPIDKeys() {
	const webCrypto = globalThis.crypto;
	if (!webCrypto?.subtle) {
		throw new Error("Web Crypto API not available");
	}

	const keyPair = await webCrypto.subtle.generateKey(
		{ name: "ECDSA", namedCurve: "P-256" },
		true,
		["sign", "verify"],
	);

	const publicJwk = await webCrypto.subtle.exportKey("jwk", keyPair.publicKey);
	const privateJwk = await webCrypto.subtle.exportKey(
		"jwk",
		keyPair.privateKey,
	);

	if (!publicJwk.x || !publicJwk.y || !privateJwk.d) {
		throw new Error("Failed to export VAPID keys");
	}

	const publicKeyBytes = Buffer.concat([
		Buffer.from([0x04]),
		base64UrlDecode(publicJwk.x),
		base64UrlDecode(publicJwk.y),
	]);

	return {
		publicKey: base64UrlEncode(publicKeyBytes),
		privateKey: privateJwk.d,
	};
}
