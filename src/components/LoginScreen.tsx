import { A } from "@solidjs/router";
import { createSignal, onMount } from "solid-js";
import { Screen } from "./Screen";
import "./ButtonStyles.css";
import "./LoginScreen.css";

export function LoginScreen() {
	const [showInstall, setShowInstall] = createSignal(false);

	onMount(() => {
		const isStandalone =
			window.matchMedia("(display-mode: standalone)").matches ||
			(navigator as Navigator & { standalone?: boolean }).standalone === true;

		setShowInstall(!isStandalone);
	});

	return (
		<Screen>
			<h1 class="login-logo">Oy</h1>
			<p class="login-tagline">The simplest social media app</p>
			<p class="login-tagline login-tagline-secondary">
				Tell your friends: Oy!
			</p>

			<div class="oauth-buttons">
				{/* Apple Sign-In disabled for now
				<a href="/api/auth/oauth/apple" class="oauth-button oauth-apple">
					<svg class="oauth-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
					</svg>
					Sign in with Apple
				</a>
				*/}

				<a href="/api/auth/oauth/google" class="oauth-button oauth-google">
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
				</a>
			</div>

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
