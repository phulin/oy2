import { Capacitor } from "@capacitor/core";
import { WebAuthn } from "@gledly/capacitor-webauthn";
import {
	logPasskeyError,
	logPasskeyEvent,
	logPasskeyStart,
} from "./passkeyDebug";
import { apiFetch } from "./utils";

type PasskeyRegisterOptions = {
	challenge: string;
	rp: { name: string; id: string };
	user: { id: string; name: string; displayName: string };
	pubKeyCredParams: { type: "public-key"; alg: number }[];
	timeout: number;
	attestation: AttestationConveyancePreference;
	authenticatorSelection: AuthenticatorSelectionCriteria;
	excludeCredentials: { type: "public-key"; id: string }[];
};

function base64UrlEncode(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
	const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
	const padding = "=".repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(base64 + padding);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function getDeviceName(): string {
	const ua = navigator.userAgent;
	if (/iPhone/.test(ua)) return "iPhone";
	if (/iPad/.test(ua)) return "iPad";
	if (/Mac/.test(ua)) return "Mac";
	if (/Android/.test(ua)) return "Android";
	if (/Windows/.test(ua)) return "Windows";
	return "Unknown Device";
}

function ensurePasskeySupport() {
	if (Capacitor.isNativePlatform()) {
		return;
	}
	if (!window.PublicKeyCredential) {
		throw new Error("Passkeys are not supported on this device");
	}
	if (!window.isSecureContext) {
		const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(
			window.location.hostname,
		);
		throw new Error(
			isLocalhost
				? "Passkeys require HTTPS. Use an https://localhost URL or a secure tunnel."
				: "Passkeys require a secure (HTTPS) connection.",
		);
	}
}

export async function registerPasskey(): Promise<void> {
	const startedAt = logPasskeyStart("register");
	ensurePasskeySupport();

	const optionsResponse = await apiFetch("/api/auth/passkey/register/options", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
	});

	if (!optionsResponse.ok) {
		throw new Error("Failed to get registration options");
	}

	const options = (await optionsResponse.json()) as PasskeyRegisterOptions;
	logPasskeyEvent("register", "options.loaded", {
		rpId: options.rp.id,
		timeout: options.timeout,
		excludeCredentialsCount: options.excludeCredentials.length,
	});

	let registrationPayload: {
		id: string;
		rawId: string;
		type: string;
		response: {
			clientDataJSON: string;
			attestationObject: string;
			transports: string[];
		};
	};
	try {
		if (Capacitor.isNativePlatform()) {
			const { available } = await WebAuthn.isAvailable();
			if (!available) {
				throw new Error("Passkeys are not available on this device");
			}

			const credential = await WebAuthn.startRegistration({
				challenge: options.challenge,
				rp: options.rp,
				user: options.user,
				pubKeyCredParams: options.pubKeyCredParams,
				timeout: options.timeout,
				attestation: options.attestation,
				authenticatorSelection: options.authenticatorSelection,
				excludeCredentials: options.excludeCredentials,
			});

			registrationPayload = {
				id: credential.id,
				rawId: credential.rawId,
				type: credential.type,
				response: {
					clientDataJSON: credential.response.clientDataJSON,
					attestationObject: credential.response.attestationObject,
					transports: ["internal"],
				},
			};
		} else {
			const credential = (await navigator.credentials.create({
				publicKey: {
					challenge: base64UrlDecode(options.challenge).buffer as ArrayBuffer,
					rp: options.rp,
					user: {
						id: base64UrlDecode(options.user.id).buffer as ArrayBuffer,
						name: options.user.name,
						displayName: options.user.displayName,
					},
					pubKeyCredParams: options.pubKeyCredParams,
					timeout: options.timeout,
					attestation: options.attestation,
					authenticatorSelection: options.authenticatorSelection,
					excludeCredentials: options.excludeCredentials.map((c) => ({
						type: c.type as "public-key",
						id: base64UrlDecode(c.id).buffer as ArrayBuffer,
					})),
				},
			})) as PublicKeyCredential | null;

			if (!credential) {
				logPasskeyEvent("register", "credential.null");
				throw new Error("Credential creation cancelled");
			}

			const response = credential.response as AuthenticatorAttestationResponse;
			registrationPayload = {
				id: credential.id,
				rawId: base64UrlEncode(credential.rawId),
				type: credential.type,
				response: {
					clientDataJSON: base64UrlEncode(response.clientDataJSON),
					attestationObject: base64UrlEncode(response.attestationObject),
					transports: response.getTransports?.() || ["internal"],
				},
			};
		}
	} catch (err) {
		logPasskeyError("register", startedAt, err);
		throw err;
	}

	const verifyResponse = await apiFetch("/api/auth/passkey/register/verify", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify({
			credential: registrationPayload,
			deviceName: getDeviceName(),
		}),
	});

	if (!verifyResponse.ok) {
		const data = (await verifyResponse.json()) as { error?: string };
		logPasskeyEvent("register", "verify.failed", data);
		throw new Error(data.error || "Registration failed");
	}

	logPasskeyEvent("register", "verify.success");
}
