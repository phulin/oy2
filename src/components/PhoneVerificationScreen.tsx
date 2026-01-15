import { Button } from "@kobalte/core/button";
import type { JSX } from "solid-js";
import { Screen } from "./Screen";
import "./ButtonStyles.css";
import "./FormControls.css";
import "./LoginScreen.css";

type PhoneVerificationScreenProps = {
	onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent>;
};

export function PhoneVerificationScreen(props: PhoneVerificationScreenProps) {
	return (
		<Screen>
			<h1 class="login-logo">Oy</h1>
			<p class="login-tagline">Verify your phone to continue</p>
			<form onSubmit={props.onSubmit}>
				<input
					type="tel"
					name="phone"
					placeholder="Enter phone number"
					autocomplete="tel"
					required
					class="app-text-input"
				/>
				<Button type="submit" class="btn-primary">
					Send Code
				</Button>
			</form>
		</Screen>
	);
}
