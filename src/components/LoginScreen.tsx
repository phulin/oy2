import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { WebAuthn } from "@gledly/capacitor-webauthn";
import { A } from "@solidjs/router";
import { createSignal, onMount, Show } from "solid-js";
import { appLogoText } from "../branding";
import {
	logPasskeyError,
	logPasskeyEvent,
	logPasskeyStart,
} from "../passkeyDebug";
import { apiFetch } from "../utils";
import { Screen } from "./Screen";
import "./ButtonStyles.css";
import "./FormControls.css";
import "./LoginScreen.css";
import "./EmailLoginScreen.css";

type LoginScreenProps = {
	onTryPasskey: () => Promise<void>;
	onEmailLogin: () => void;
	onEmailSignup: (username: string) => void;
};

export function LoginScreen(props: LoginScreenProps) {
	const [mode, setMode] = createSignal<"home" | "pick_method">("home");
	const [signingIn, setSigningIn] = createSignal(false);
	const [passkeyError, setPasskeyError] = createSignal<string | null>(null);
	const [username, setUsername] = createSignal("");
	const [usernameError, setUsernameError] = createSignal<string | null>(null);
	const [checking, setChecking] = createSignal(false);
	const [googleError, setGoogleError] = createSignal<string | null>(null);
	const [appleError, setAppleError] = createSignal<string | null>(null);
	const isNative = Capacitor.isNativePlatform();

	onMount(() => {
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

	function validateUsernameFormat(value: string): string | null {
		if (!value) return "Username is required";
		if (value.length < 2) return "Username must be at least 2 characters";
		if (value.length > 20) return "Username must be 20 characters or less";
		if (!/^[a-zA-Z0-9_]+$/.test(value))
			return "Only letters, numbers, and underscores";
		return null;
	}

	async function handleSignUp(): Promise<void> {
		const value = username().trim();
		const formatError = validateUsernameFormat(value);
		if (formatError) {
			setUsernameError(formatError);
			return;
		}

		setUsernameError(null);
		setChecking(true);

		try {
			const response = await apiFetch("/api/auth/username/check", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: value }),
			});

			const data = (await response.json()) as {
				available: boolean;
				error?: string;
			};

			if (!data.available) {
				setUsernameError(data.error || "Username already taken");
				return;
			}

			setMode("pick_method");
		} catch {
			setUsernameError("Something went wrong. Please try again.");
		} finally {
			setChecking(false);
		}
	}

	async function handleNativeGoogleLogin(
		signupUsername?: string,
	): Promise<void> {
		setGoogleError(null);
		try {
			const res = await SocialLogin.login({
				provider: "google",
				options: {},
			});

			const idToken = (res.result as { idToken?: string | null }).idToken;
			if (!idToken) {
				setGoogleError("Google sign-in did not return an ID token.");
				return;
			}

			const body: { idToken: string; username?: string } = { idToken };
			if (signupUsername) {
				body.username = signupUsername;
			}

			const response = await apiFetch("/api/auth/oauth/google/native", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify(body),
			});

			const data = (await response.json()) as
				| { user: unknown; needsPasskeySetup?: boolean }
				| { needsUsername: true }
				| { error: string };

			if (!response.ok) {
				setGoogleError((data as { error: string }).error || "Login failed");
				return;
			}

			if ("needsUsername" in data && data.needsUsername) {
				window.location.href = "/?choose_username=1";
				return;
			}

			if ("needsPasskeySetup" in data && data.needsPasskeySetup) {
				window.location.href = "/?passkey_setup=1";
				return;
			}

			window.location.href = "/";
		} catch (err) {
			const msg = (err as Error).message || "";
			if (msg.includes("cancel") || msg.includes("Cancel")) {
				return;
			}
			setGoogleError(msg || "Google sign-in failed");
		}
	}

	async function handleNativeAppleLogin(
		signupUsername?: string,
	): Promise<void> {
		setAppleError(null);
		try {
			const res = await SocialLogin.login({
				provider: "apple",
				options: { scopes: ["email", "name"] },
			});

			const result = res.result as {
				idToken?: string | null;
				profile?: { givenName?: string | null; familyName?: string | null };
			};
			const idToken = result.idToken;
			if (!idToken) {
				setAppleError("Apple sign-in did not return an ID token.");
				return;
			}

			const fullName = [result.profile?.givenName, result.profile?.familyName]
				.filter(Boolean)
				.join(" ");
			const body: { idToken: string; username?: string; name?: string } = {
				idToken,
			};
			if (signupUsername) {
				body.username = signupUsername;
			}
			if (fullName) {
				body.name = fullName;
			}

			const response = await apiFetch("/api/auth/oauth/apple/native", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify(body),
			});

			const data = (await response.json()) as
				| { user: unknown; needsPasskeySetup?: boolean }
				| { needsUsername: true }
				| { error: string };

			if (!response.ok) {
				setAppleError((data as { error: string }).error || "Login failed");
				return;
			}

			if ("needsUsername" in data && data.needsUsername) {
				window.location.href = "/?choose_username=1";
				return;
			}

			if ("needsPasskeySetup" in data && data.needsPasskeySetup) {
				window.location.href = "/?passkey_setup=1";
				return;
			}

			window.location.href = "/";
		} catch (err) {
			const msg = (err as Error).message || "";
			if (msg.includes("cancel") || msg.includes("Cancel")) {
				return;
			}
			setAppleError(msg || "Apple sign-in failed");
		}
	}

	function proceedWithGoogle() {
		const value = username().trim();
		if (isNative) {
			void handleNativeGoogleLogin(value);
		} else {
			window.location.href = `/api/auth/oauth/google?username=${encodeURIComponent(value)}`;
		}
	}

	function proceedWithApple() {
		const value = username().trim();
		if (isNative) {
			void handleNativeAppleLogin(value);
		} else {
			window.location.href = `/api/auth/oauth/apple?username=${encodeURIComponent(value)}`;
		}
	}

	function proceedWithEmail() {
		props.onEmailSignup(username().trim());
	}

	async function handlePasskeyLogin() {
		const startedAt = logPasskeyStart("login");
		if (!Capacitor.isNativePlatform() && !window.PublicKeyCredential) {
			setPasskeyError("Passkeys are not supported on this device");
			logPasskeyEvent("login", "unsupported.public-key-credential");
			return;
		}
		if (!Capacitor.isNativePlatform() && !window.isSecureContext) {
			setPasskeyError("Passkeys require a secure (HTTPS) connection.");
			logPasskeyEvent("login", "unsupported.insecure-context");
			return;
		}

		setSigningIn(true);
		setPasskeyError(null);

		try {
			const optionsResponse = await apiFetch("/api/auth/passkey/auth/options", {
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
			logPasskeyEvent("login", "options.loaded", {
				rpId: options.rpId,
				timeout: options.timeout,
			});

			let authPayload: {
				id: string;
				rawId: string;
				type: string;
				response: {
					clientDataJSON: string;
					authenticatorData: string;
					signature: string;
					userHandle: string | null;
				};
			};

			if (Capacitor.isNativePlatform()) {
				const { available } = await WebAuthn.isAvailable();
				if (!available) {
					throw new Error("Passkeys are not available on this device");
				}
				const credential = await WebAuthn.startAuthentication({
					challenge: options.challenge,
					rpId: options.rpId,
					timeout: options.timeout,
					userVerification: options.userVerification,
					allowCredentials: [],
				});
				authPayload = {
					id: credential.id,
					rawId: credential.rawId,
					type: credential.type,
					response: {
						clientDataJSON: credential.response.clientDataJSON,
						authenticatorData: credential.response.authenticatorData,
						signature: credential.response.signature,
						userHandle: credential.response.userHandle ?? null,
					},
				};
			} else {
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
					logPasskeyEvent("login", "credential.null");
					throw new Error("Passkey login cancelled");
				}

				const response = credential.response as AuthenticatorAssertionResponse;
				authPayload = {
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
				};
			}

			const verifyResponse = await apiFetch("/api/auth/passkey/auth/verify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					authId: options.authId,
					credential: authPayload,
				}),
			});

			if (!verifyResponse.ok) {
				const data = (await verifyResponse.json()) as { error?: string };
				logPasskeyEvent("login", "verify.failed", data);
				throw new Error(data.error || "Passkey login failed");
			}

			logPasskeyEvent("login", "verify.success");
			window.location.href = "/";
		} catch (err) {
			logPasskeyError("login", startedAt, err);
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

	const GoogleIcon = () => (
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
	);

	const EmailIcon = () => (
		<svg
			class="oauth-icon"
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M1.5 8.67v8.58a3 3 0 003 3h15a3 3 0 003-3V8.67l-8.928 5.493a3 3 0 01-3.144 0L1.5 8.67z" />
			<path d="M22.5 6.908V6.75a3 3 0 00-3-3h-15a3 3 0 00-3 3v.158l9.714 5.978a1.5 1.5 0 001.572 0L22.5 6.908z" />
		</svg>
	);

	const AppleIcon = () => (
		<svg
			class="oauth-icon"
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M16.365 12.36c-.014-2.32 1.895-3.433 1.982-3.486-1.082-1.58-2.768-1.797-3.368-1.82-1.433-.145-2.799.846-3.529.846-.728 0-1.852-.825-3.045-.803-1.567.022-3.012.91-3.817 2.313-1.628 2.824-.414 7.001 1.17 9.29.774 1.117 1.694 2.372 2.905 2.328 1.167-.046 1.607-.754 3.018-.754 1.412 0 1.809.754 3.04.73 1.26-.021 2.057-1.139 2.825-2.26.89-1.299 1.256-2.556 1.278-2.622-.028-.011-2.446-.939-2.459-3.762z" />
			<path d="M14.008 5.516c.644-.78 1.078-1.867.96-2.947-.928.037-2.052.618-2.717 1.396-.597.688-1.122 1.79-.98 2.842 1.036.08 2.093-.527 2.737-1.291z" />
		</svg>
	);

	return (
		<Screen>
			<h1 class="login-logo">{appLogoText}</h1>
			<p class="login-tagline">The simplest social media app</p>

			<Show
				when={mode() === "home"}
				fallback={
					<>
						{/* Pick Registration Method Screen */}
						<h2 class="signup-heading">Sign up as {username().trim()}</h2>
						<p class="signup-acknowledgement">
							By continuing, you confirm you are 18 or older and agree to our{" "}
							<A href="/terms">Terms of Use</A>.
						</p>

						<div class="signup-buttons">
							<button
								type="button"
								class="oauth-button oauth-apple"
								onClick={proceedWithApple}
							>
								<AppleIcon />
								Continue with Apple
							</button>

							<button
								type="button"
								class="oauth-button oauth-google"
								onClick={proceedWithGoogle}
							>
								<GoogleIcon />
								Continue with Google
							</button>

							<button
								type="button"
								class="oauth-button oauth-email"
								onClick={proceedWithEmail}
							>
								<EmailIcon />
								Continue with email
							</button>
						</div>

						<button
							type="button"
							class="login-mode-link"
							onClick={() => setMode("home")}
						>
							Back
						</button>
					</>
				}
			>
				{/* Home Screen */}
				<h2 class="signup-heading">Sign Up</h2>

				<div class="signup-section">
					<div class="signup-input-wrap">
						<input
							type="text"
							placeholder="Choose a username"
							autocomplete="username"
							class="app-text-input signup-input"
							value={username()}
							onInput={(e) => {
								setUsername(e.currentTarget.value);
								setUsernameError(null);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") void handleSignUp();
							}}
							minLength={2}
							maxLength={20}
							disabled={checking()}
						/>
						<button
							type="button"
							class="signup-arrow"
							onClick={handleSignUp}
							disabled={checking()}
							aria-label="Sign up"
						>
							<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
								<path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" />
							</svg>
						</button>
					</div>

					<Show when={usernameError()}>
						<p class="form-error">{usernameError()}</p>
					</Show>
				</div>

				{/* Sign In Section */}
				<div class="login-divider">
					<span>Already have an account?</span>
				</div>

				<div class="signin-buttons">
					<button
						type="button"
						class="signin-button oauth-apple"
						onClick={() => {
							if (isNative) {
								void handleNativeAppleLogin();
							} else {
								window.location.href = "/api/auth/oauth/apple";
							}
						}}
					>
						<AppleIcon />
						Sign in with Apple
					</button>
					<button
						type="button"
						class="signin-button oauth-google"
						onClick={() => {
							if (isNative) {
								void handleNativeGoogleLogin();
							} else {
								window.location.href = "/api/auth/oauth/google";
							}
						}}
					>
						<GoogleIcon />
						Sign in with Google
					</button>
					<button
						type="button"
						class="signin-button oauth-email"
						onClick={props.onEmailLogin}
					>
						<EmailIcon />
						Sign in with email
					</button>
					<button
						type="button"
						class="signin-button signin-passkey"
						onClick={handlePasskeyLogin}
						disabled={signingIn()}
					>
						<svg
							class="oauth-icon"
							viewBox="0 0 24 24"
							fill="currentColor"
							aria-hidden="true"
						>
							<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
						</svg>
						{signingIn() ? "Signing in..." : "Sign in with passkey"}
					</button>
				</div>
				{passkeyError() && <p class="form-error">{passkeyError()}</p>}
				{googleError() && <p class="form-error">{googleError()}</p>}
				{appleError() && <p class="form-error">{appleError()}</p>}
			</Show>

			<footer class="login-legal">
				<A class="login-legal-link" href="/terms">
					Terms
				</A>
				<span class="login-legal-separator">·</span>
				<A class="login-legal-link" href="/privacy">
					Privacy
				</A>
				<span class="login-legal-separator">·</span>
				<A class="login-legal-link" href="/cookies">
					Cookies
				</A>
				<span class="login-legal-separator">·</span>
				<A class="login-legal-link" href="/legal">
					Other
				</A>
			</footer>
		</Screen>
	);
}
