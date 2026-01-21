import { Button } from "@kobalte/core/button";
import { createSignal } from "solid-js";
import { Screen } from "./Screen";
import "./ButtonStyles.css";
import "./LoginScreen.css";

type PasskeySetupScreenProps = {
	onComplete: () => void;
	onSkip: () => void;
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

export function PasskeySetupScreen(props: PasskeySetupScreenProps) {
	const [setting, setSetting] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	async function handleSetup() {
		if (!window.PublicKeyCredential) {
			setError("Passkeys are not supported on this device");
			return;
		}

		if (!window.isSecureContext) {
			const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(
				window.location.hostname,
			);
			setError(
				isLocalhost
					? "Passkeys require HTTPS. Use an https://localhost URL or a secure tunnel."
					: "Passkeys require a secure (HTTPS) connection.",
			);
			return;
		}

		setSetting(true);
		setError(null);

		try {
			// Get registration options from server
			const optionsResponse = await fetch(
				"/api/auth/passkey/register/options",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
				},
			);

			if (!optionsResponse.ok) {
				throw new Error("Failed to get registration options");
			}

			const options = (await optionsResponse.json()) as {
				challenge: string;
				rp: { name: string; id: string };
				user: { id: string; name: string; displayName: string };
				pubKeyCredParams: { type: "public-key"; alg: number }[];
				timeout: number;
				attestation: AttestationConveyancePreference;
				authenticatorSelection: AuthenticatorSelectionCriteria;
				excludeCredentials: { type: "public-key"; id: string }[];
			};

			// Create credential
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
				throw new Error("Credential creation cancelled");
			}

			const response = credential.response as AuthenticatorAttestationResponse;

			// Send credential to server
			const verifyResponse = await fetch("/api/auth/passkey/register/verify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					credential: {
						id: credential.id,
						rawId: base64UrlEncode(credential.rawId),
						type: credential.type,
						response: {
							clientDataJSON: base64UrlEncode(response.clientDataJSON),
							attestationObject: base64UrlEncode(response.attestationObject),
							transports: response.getTransports?.() || ["internal"],
						},
					},
					deviceName: getDeviceName(),
				}),
			});

			if (!verifyResponse.ok) {
				const data = (await verifyResponse.json()) as { error?: string };
				throw new Error(data.error || "Registration failed");
			}

			props.onComplete();
		} catch (err) {
			if ((err as Error).name === "NotAllowedError") {
				setError("Setup was cancelled. You can try again or skip for now.");
			} else {
				setError((err as Error).message || "Setup failed. Please try again.");
			}
		} finally {
			setSetting(false);
		}
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

	return (
		<Screen>
			<div class="passkey-setup">
				<div class="passkey-icon">
					<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M12 1C8.14 1 5 4.14 5 8c0 2.38 1.19 4.47 3 5.74V17a1 1 0 001 1h1v2a1 1 0 001 1h2a1 1 0 001-1v-2h1a1 1 0 001-1v-3.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm0 2c2.76 0 5 2.24 5 5 0 1.64-.81 3.09-2.03 4h-5.94C7.81 11.09 7 9.64 7 8c0-2.76 2.24-5 5-5z" />
					</svg>
				</div>

				<h2 class="passkey-title">Set Up Quick Login</h2>
				<p class="passkey-description">
					Use a passkey to sign in instantly next time. Your passkey syncs
					securely across your devices.
				</p>

				{error() && <p class="form-error">{error()}</p>}

				<div class="passkey-buttons">
					<Button
						class="btn-primary"
						onClick={handleSetup}
						disabled={setting()}
					>
						{setting() ? "Setting up..." : "Set up passkey"}
					</Button>

					<button
						type="button"
						class="passkey-skip"
						onClick={props.onSkip}
						disabled={setting()}
					>
						Skip for now
					</button>
				</div>
			</div>
		</Screen>
	);
}
