import { Button } from "@kobalte/core/button";
import { createSignal, Show } from "solid-js";
import { apiFetch } from "../utils";
import { Screen } from "./Screen";
import { VerifyCodeScreen } from "./VerifyCodeScreen";
import "./ButtonStyles.css";
import "./FormControls.css";
import "./LoginScreen.css";
import "./EmailLoginScreen.css";

type EmailLoginResult =
	| { status: "choose_username" }
	| {
			status: "authenticated";
			user: { id: number; username: string };
			needsPasskeySetup: boolean;
	  };

type EmailLoginScreenProps = {
	onSuccess: (result: EmailLoginResult) => void;
	onBack: () => void;
	signupUsername?: string;
};

export function EmailLoginScreen(props: EmailLoginScreenProps) {
	const [step, setStep] = createSignal<"email" | "code">("email");
	const [email, setEmail] = createSignal("");
	const [code, setCode] = createSignal("");
	const [error, setError] = createSignal<string | null>(null);
	const [sending, setSending] = createSignal(false);
	const [verifying, setVerifying] = createSignal(false);
	const [resending, setResending] = createSignal(false);

	async function tryCompleteWithUsername(
		username: string,
	): Promise<EmailLoginResult | null> {
		try {
			const response = await apiFetch("/api/auth/email/complete", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username }),
				credentials: "include",
			});

			if (!response.ok) return null;

			const data = (await response.json()) as {
				user: { id: number; username: string };
				needsPasskeySetup: boolean;
			};

			return {
				status: "authenticated",
				user: data.user,
				needsPasskeySetup: data.needsPasskeySetup,
			};
		} catch {
			return null;
		}
	}

	async function handleSendCode(event: SubmitEvent) {
		event.preventDefault();
		const emailValue = email().trim().toLowerCase();

		if (!emailValue) return;

		setError(null);
		setSending(true);

		try {
			const response = await apiFetch("/api/auth/email/send-code", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email: emailValue }),
				credentials: "include",
			});

			const data = (await response.json()) as
				| { status: string }
				| { error: string };

			if (!response.ok) {
				setError((data as { error: string }).error || "Failed to send code");
				return;
			}

			setStep("code");
		} catch {
			setError("Something went wrong. Please try again.");
		} finally {
			setSending(false);
		}
	}

	async function handleVerifyCode(event: SubmitEvent) {
		event.preventDefault();
		const codeValue = code().trim();

		if (!codeValue || codeValue.length !== 6) {
			setError("Please enter the 6-digit code");
			return;
		}

		setError(null);
		setVerifying(true);

		try {
			const response = await apiFetch("/api/auth/email/verify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: email().trim().toLowerCase(),
					code: codeValue,
				}),
				credentials: "include",
			});

			const data = (await response.json()) as
				| {
						status: "choose_username";
				  }
				| {
						status: "authenticated";
						user: { id: number; username: string };
						needsPasskeySetup: boolean;
				  }
				| { error: string };

			if (!response.ok) {
				setError((data as { error: string }).error || "Verification failed");
				return;
			}

			const result = data as EmailLoginResult;

			// If we have a pre-selected signup username and verification created a pending user,
			// auto-complete registration with that username
			if (result.status === "choose_username" && props.signupUsername) {
				const completeResult = await tryCompleteWithUsername(
					props.signupUsername,
				);
				if (completeResult) {
					props.onSuccess(completeResult);
					return;
				}
				// Fall through to choose_username if auto-complete failed
			}

			props.onSuccess(result);
		} catch {
			setError("Something went wrong. Please try again.");
		} finally {
			setVerifying(false);
		}
	}

	async function handleResendCode() {
		setError(null);
		setResending(true);

		try {
			const response = await apiFetch("/api/auth/email/send-code", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email: email().trim().toLowerCase() }),
				credentials: "include",
			});

			const data = (await response.json()) as
				| { status: string }
				| { error: string };

			if (!response.ok) {
				setError((data as { error: string }).error || "Failed to resend code");
				return;
			}

			setError(null);
			setCode("");
		} catch {
			setError("Something went wrong. Please try again.");
		} finally {
			setResending(false);
		}
	}

	return (
		<Show
			when={step() === "code"}
			fallback={
				<Screen>
					<h1 class="login-logo">Oy</h1>
					<p class="login-tagline">Sign in with email</p>
					<p class="login-tagline login-tagline-secondary">
						We'll send you a verification code
					</p>

					<form onSubmit={handleSendCode}>
						<input
							type="email"
							placeholder="Email address"
							autocomplete="email"
							required
							class="app-text-input"
							value={email()}
							onInput={(e) => setEmail(e.currentTarget.value)}
							disabled={sending()}
						/>

						<Show when={error()}>
							<p class="form-error">{error()}</p>
						</Show>

						<Button type="submit" class="btn-primary" disabled={sending()}>
							{sending() ? "Sending..." : "Send code"}
						</Button>
					</form>

					<button type="button" class="email-back-link" onClick={props.onBack}>
						Back to login options
					</button>
				</Screen>
			}
		>
			<VerifyCodeScreen
				title="Enter verification code"
				subtitle={`Sent to ${email()}`}
				value={code()}
				onValueChange={setCode}
				onSubmit={handleVerifyCode}
				error={error()}
				loading={verifying()}
				submitLabel="Verify"
				footer={
					<div class="email-code-actions">
						<button
							type="button"
							class="email-back-link"
							onClick={handleResendCode}
							disabled={verifying() || resending()}
						>
							{resending() ? "Resending..." : "Resend code"}
						</button>
						<span class="email-action-separator">·</span>
						<button
							type="button"
							class="email-back-link"
							onClick={() => {
								setStep("email");
								setCode("");
								setError(null);
							}}
						>
							Use different email
						</button>
					</div>
				}
			/>
		</Show>
	);
}
