import { Button } from "@kobalte/core/button";
import { type JSX, onMount } from "solid-js";
import { Screen } from "./Screen";
import "./ButtonStyles.css";
import "./FormControls.css";
import "./LoginScreen.css";

type PhoneVerificationScreenProps = {
	onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent>;
};

export function PhoneVerificationScreen(props: PhoneVerificationScreenProps) {
	let phoneInput!: HTMLInputElement;

	onMount(() => {
		phoneInput.focus();
	});

	return (
		<Screen>
			<h1 class="login-logo">Oy</h1>
			<p class="login-tagline">Verify your phone to continue</p>
			<form onSubmit={props.onSubmit}>
				<input
					ref={phoneInput}
					type="tel"
					name="phone"
					placeholder="Enter phone number"
					autocomplete="tel"
					autofocus
					required
					class="app-text-input"
				/>
				<Button type="submit" class="btn-primary">
					Send Code
				</Button>
				<p class="login-note">
					By providing your phone number you agree to receive informational text
					messages from Oy. Frequency will vary; message &amp; data rates may
					apply. Reply STOP to cancel.
				</p>
			</form>
		</Screen>
	);
}
