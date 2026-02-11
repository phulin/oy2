import { Button } from "@kobalte/core/button";
import { For, type JSX, onMount, Show } from "solid-js";
import { appLogoText } from "../branding";
import { Screen } from "./Screen";
import "./ButtonStyles.css";
import "./FormControls.css";
import "./LoginScreen.css";
import "./VerifyCodeScreen.css";

type VerifyCodeScreenProps = {
	title: string;
	subtitle?: string;
	value: string;
	onValueChange: (value: string) => void;
	onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent>;
	error?: string | null;
	loading?: boolean;
	submitLabel?: string;
	footer?: JSX.Element;
};

export function VerifyCodeScreen(props: VerifyCodeScreenProps) {
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
		props.onValueChange(nextValue);
		if (nextValue.length === 6) {
			formRef?.requestSubmit();
		}
	};

	const activeIndex = () => Math.min(props.value.length, 5);
	const submitText = () =>
		props.loading ? "Verifying..." : (props.submitLabel ?? "Verify");

	return (
		<Screen>
			<h1 class="login-logo">{appLogoText}</h1>
			<p class="login-tagline">{props.title}</p>
			<Show when={props.subtitle}>
				{(subtitle) => (
					<p class="login-tagline login-tagline-secondary">{subtitle()}</p>
				)}
			</Show>
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
						value={props.value}
						onInput={handleInput}
						aria-label="Verification code"
						disabled={props.loading}
					/>
					<div class="otp-boxes" aria-hidden="true">
						<For each={[0, 1, 2, 3, 4, 5]}>
							{(index) => (
								<span
									class="otp-box"
									classList={{
										"otp-box-filled": index < props.value.length,
										"otp-box-active": index === activeIndex(),
									}}
								>
									{props.value[index] || ""}
								</span>
							)}
						</For>
					</div>
				</div>
				<Show when={props.error}>
					{(error) => <p class="form-error">{error()}</p>}
				</Show>
				<Button type="submit" class="btn-primary" disabled={props.loading}>
					{submitText()}
				</Button>
			</form>
			<Show when={props.footer}>{(footer) => footer()}</Show>
		</Screen>
	);
}
