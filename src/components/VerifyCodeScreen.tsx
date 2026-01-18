import { Button } from "@kobalte/core/button";
import { createSignal, For, type JSX, onMount } from "solid-js";
import { Screen } from "./Screen";
import "./ButtonStyles.css";
import "./FormControls.css";
import "./LoginScreen.css";
import "./VerifyCodeScreen.css";

type VerifyCodeScreenProps = {
	onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent>;
};

export function VerifyCodeScreen(props: VerifyCodeScreenProps) {
	const [otp, setOtp] = createSignal("");
	let formRef: HTMLFormElement | undefined;
	let inputRef: HTMLInputElement | undefined;

	onMount(() => {
		inputRef?.focus();
	});

	const handleInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (
		event,
	) => {
		const nextValue = event.currentTarget.value.replace(/\D/g, "").slice(0, 6);
		event.currentTarget.value = nextValue;
		setOtp(nextValue);
		if (nextValue.length === 6) {
			formRef?.requestSubmit();
		}
	};

	const activeIndex = () => Math.min(otp().length, 5);

	return (
		<Screen>
			<h1 class="login-logo">Oy</h1>
			<p class="login-tagline">Enter the code we texted you</p>
			<form onSubmit={props.onSubmit} ref={formRef}>
				<div class="otp-field">
					<input
						type="text"
						name="otp"
						ref={inputRef}
						autocomplete="one-time-code"
						inputmode="numeric"
						autofocus
						required
						class="otp-input"
						value={otp()}
						onInput={handleInput}
						aria-label="Verification code"
					/>
					<div class="otp-boxes" aria-hidden="true">
						<For each={[0, 1, 2, 3, 4, 5]}>
							{(index) => (
								<span
									class="otp-box"
									classList={{
										"otp-box-filled": index < otp().length,
										"otp-box-active": index === activeIndex(),
									}}
								>
									{otp()[index] || ""}
								</span>
							)}
						</For>
					</div>
				</div>
				<Button type="submit" class="btn-primary">
					Verify
				</Button>
			</form>
		</Screen>
	);
}
