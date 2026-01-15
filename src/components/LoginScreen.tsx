import { Button } from "@kobalte/core/button";
import type { JSX } from "solid-js";
import { createSignal, onMount } from "solid-js";
import { Screen } from "./Screen";
import "./ButtonStyles.css";
import "./FormControls.css";
import "./LoginScreen.css";

type LoginScreenProps = {
	onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent>;
};

export function LoginScreen(props: LoginScreenProps) {
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
			<p class="login-tagline">Send Oys to your friends</p>
			<form onSubmit={props.onSubmit}>
				<input
					type="text"
					name="username"
					placeholder="Enter username"
					autocomplete="username"
					required
					minlength="2"
					maxlength="20"
					class="app-text-input"
				/>
				<Button type="submit" class="btn-primary">
					Get Started
				</Button>
			</form>
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
		</Screen>
	);
}
