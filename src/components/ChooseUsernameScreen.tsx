import { Button } from "@kobalte/core/button";
import { createSignal, onMount, Show } from "solid-js";
import { Screen } from "./Screen";
import "./ButtonStyles.css";
import "./FormControls.css";
import "./LoginScreen.css";

type OAuthPendingInfo = {
	provider: string;
	email?: string;
	name?: string;
};

type ChooseUsernameScreenProps = {
	onComplete: (user: { id: number; username: string }) => void;
};

export function ChooseUsernameScreen(props: ChooseUsernameScreenProps) {
	const [pendingInfo, setPendingInfo] = createSignal<OAuthPendingInfo | null>(
		null,
	);
	const [error, setError] = createSignal<string | null>(null);
	const [submitting, setSubmitting] = createSignal(false);

	onMount(async () => {
		try {
			const response = await fetch("/api/auth/oauth/pending", {
				credentials: "include",
			});
			if (response.ok) {
				const data = (await response.json()) as OAuthPendingInfo;
				setPendingInfo(data);
			}
		} catch {
			// Ignore errors
		}
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const formData = new FormData(form);
		const username = String(formData.get("username") || "").trim();

		if (!username) return;

		setError(null);
		setSubmitting(true);

		try {
			const response = await fetch("/api/auth/oauth/complete", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username }),
				credentials: "include",
			});

			const data = (await response.json()) as
				| {
						user: { id: number; username: string };
						needsPasskeySetup?: boolean;
						claimed?: boolean;
				  }
				| { error: string };

			if (!response.ok) {
				setError((data as { error: string }).error || "Registration failed");
				return;
			}

			const result = data as {
				user: { id: number; username: string };
				claimed?: boolean;
			};
			props.onComplete(result.user);
		} catch {
			setError("Something went wrong. Please try again.");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Screen>
			<h1 class="login-logo">Oy</h1>
			<p class="login-tagline">Choose your username</p>

			<Show when={pendingInfo()}>
				{(info) => (
					<p class="login-note" style={{ "margin-bottom": "1.5rem" }}>
						Signed in with {info().provider}
						{info().email && ` as ${info().email}`}
					</p>
				)}
			</Show>

			<form onSubmit={handleSubmit}>
				<input
					type="text"
					name="username"
					placeholder="Enter username"
					autocomplete="username"
					required
					minlength={2}
					maxlength={20}
					pattern="[a-zA-Z0-9_]+"
					class="app-text-input"
					disabled={submitting()}
				/>

				<Show when={error()}>
					<p class="form-error">{error()}</p>
				</Show>

				<Button type="submit" class="btn-primary" disabled={submitting()}>
					{submitting() ? "Creating account..." : "Continue"}
				</Button>
			</form>

			<p class="login-note">
				Username can only contain letters, numbers, and underscores.
				<br />
				<strong>Already have an account?</strong> Enter your existing username
				to link it.
			</p>
		</Screen>
	);
}
