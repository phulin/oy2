import { Button } from "@kobalte/core/button";
import type { JSX } from "solid-js";
import { Screen } from "./Screen";
import "./ButtonStyles.css";
import "./FormControls.css";
import "./LoginScreen.css";

type LoginScreenProps = {
	onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent>;
};

export function LoginScreen(props: LoginScreenProps) {
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
		</Screen>
	);
}
