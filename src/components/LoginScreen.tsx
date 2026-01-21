import { A } from "@solidjs/router";
import { createSignal, onMount } from "solid-js";
import { Screen } from "./Screen";
import "./ButtonStyles.css";
import "./LoginScreen.css";
import "./EmailLoginScreen.css";

type LoginScreenProps = {
	onTryPasskey: () => Promise<void>;
	onEmailLogin: () => void;
};

export function LoginScreen(props: LoginScreenProps) {
	const [showInstall, setShowInstall] = createSignal(false);
	const [signingIn, setSigningIn] = createSignal(false);
	const [passkeyError, setPasskeyError] = createSignal<string | null>(null);

	onMount(() => {
		const isStandalone =
			window.matchMedia("(display-mode: standalone)").matches ||
			(navigator as Navigator & { standalone?: boolean }).standalone === true;

		setShowInstall(!isStandalone);
		void props.onTryPasskey();
	});

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

	async function handlePasskeyLogin() {
		if (!window.PublicKeyCredential) {
			setPasskeyError("Passkeys are not supported on this device");
			return;
		}
		if (!window.isSecureContext) {
			setPasskeyError("Passkeys require a secure (HTTPS) connection.");
			return;
		}

		setSigningIn(true);
		setPasskeyError(null);

		try {
			const optionsResponse = await fetch("/api/auth/passkey/auth/options", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
			});

			if (!optionsResponse.ok) {
				throw new Error("Failed to get passkey options");
			}

			const options = (await optionsResponse.json()) as {
				authId: string;
				challenge: string;
				rpId: string;
				timeout: number;
				userVerification: UserVerificationRequirement;
			};

			const credential = (await navigator.credentials.get({
				publicKey: {
					challenge: base64UrlDecode(options.challenge).buffer as ArrayBuffer,
					rpId: options.rpId,
					timeout: options.timeout,
					userVerification: options.userVerification,
					allowCredentials: [],
				},
			})) as PublicKeyCredential | null;

			if (!credential) {
				throw new Error("Passkey login cancelled");
			}

			const response = credential.response as AuthenticatorAssertionResponse;

			const verifyResponse = await fetch("/api/auth/passkey/auth/verify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					authId: options.authId,
					credential: {
						id: credential.id,
						rawId: base64UrlEncode(credential.rawId),
						type: credential.type,
						response: {
							clientDataJSON: base64UrlEncode(response.clientDataJSON),
							authenticatorData: base64UrlEncode(response.authenticatorData),
							signature: base64UrlEncode(response.signature),
							userHandle: response.userHandle
								? base64UrlEncode(response.userHandle)
								: null,
						},
					},
				}),
			});

			if (!verifyResponse.ok) {
				const data = (await verifyResponse.json()) as { error?: string };
				throw new Error(data.error || "Passkey login failed");
			}

			window.location.href = "/";
		} catch (err) {
			if ((err as Error).name === "NotAllowedError") {
				setPasskeyError("Passkey login cancelled.");
			} else {
				setPasskeyError(
					(err as Error).message || "Passkey login failed. Try again.",
				);
			}
		} finally {
			setSigningIn(false);
		}
	}

	return (
		<Screen>
			<h1 class="login-logo">Oy</h1>
			<p class="login-tagline">The simplest social media app</p>
			<p class="login-tagline login-tagline-secondary">
				Tell your friends: Oy!
			</p>

			<div class="oauth-buttons">
				<button
					type="button"
					class="oauth-button btn-primary"
					onClick={handlePasskeyLogin}
					disabled={signingIn()}
				>
					{signingIn() ? "Signing in..." : "Sign in with passkey"}
				</button>
				{/* Apple Sign-In disabled for now
				<a href="/api/auth/oauth/apple" class="oauth-button oauth-apple">
					<svg class="oauth-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
					</svg>
					Sign in with Apple
				</a>
				*/}

				<button
					type="button"
					class="oauth-button oauth-google"
					onClick={() => {
						window.location.href = "/api/auth/oauth/google";
					}}
				>
					<svg class="oauth-icon" viewBox="0 0 24 24" aria-hidden="true">
						<path
							fill="#4285F4"
							d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
						/>
						<path
							fill="#34A853"
							d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
						/>
						<path
							fill="#FBBC05"
							d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
						/>
						<path
							fill="#EA4335"
							d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
						/>
					</svg>
					Sign in with Google
				</button>

				<button
					type="button"
					class="oauth-button oauth-email"
					onClick={props.onEmailLogin}
				>
					<svg
						class="oauth-icon"
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-hidden="true"
					>
						<path d="M1.5 8.67v8.58a3 3 0 003 3h15a3 3 0 003-3V8.67l-8.928 5.493a3 3 0 01-3.144 0L1.5 8.67z" />
						<path d="M22.5 6.908V6.75a3 3 0 00-3-3h-15a3 3 0 00-3 3v.158l9.714 5.978a1.5 1.5 0 001.572 0L22.5 6.908z" />
					</svg>
					Sign in with email
				</button>
			</div>
			{passkeyError() && <p class="form-error">{passkeyError()}</p>}

			{showInstall() && (
				<section class="login-install">
					<h2 class="login-install-title">
						Important: Install Oy to home screen
					</h2>
					<h3 class="login-install-subtitle">
						You'll need this for notifications!
					</h3>
					<ul class="login-install-list">
						<li>iPhone: tap Share, then "Add to Home Screen".</li>
						<li>Android: tap the menu, then "Install app".</li>
					</ul>
				</section>
			)}
			<footer class="login-legal">
				<A class="login-legal-link" href="/terms">
					Terms
				</A>
				<span class="login-legal-separator">·</span>
				<A class="login-legal-link" href="/privacy">
					Privacy
				</A>
			</footer>
		</Screen>
	);
}
