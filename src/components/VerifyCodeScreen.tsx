import { Button } from "@kobalte/core/button";
import type { JSX } from "solid-js";
import { Screen } from "./Screen";
import "./ButtonStyles.css";
import "./FormControls.css";
import "./LoginScreen.css";

type VerifyCodeScreenProps = {
	onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent>;
};

export function VerifyCodeScreen(props: VerifyCodeScreenProps) {
	return (
		<Screen>
			<h1 class="login-logo">Oy</h1>
			<p class="login-tagline">Enter the code we texted you</p>
			<form onSubmit={props.onSubmit}>
				<input
					type="text"
					name="otp"
					placeholder="Enter verification code"
					autocomplete="one-time-code"
					inputmode="numeric"
					required
					class="app-text-input"
				/>
				<Button type="submit" class="btn-primary">
					Verify
				</Button>
			</form>
		</Screen>
	);
}
