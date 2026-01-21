import { Button } from "@kobalte/core/button";
import { createSignal, onMount, Show } from "solid-js";
import { Screen } from "./Screen";
import "./ButtonStyles.css";
import "./FormControls.css";
import "./LoginScreen.css";

type PendingInfo = {
	provider: string;
	email?: string;
	name?: string;
	source: "oauth" | "email";
};

type ChooseUsernameScreenProps = {
	onComplete: (
		user: { id: number; username: string },
		needsPasskeySetup: boolean,
	) => void;
};

export function ChooseUsernameScreen(props: ChooseUsernameScreenProps) {
	const [pendingInfo, setPendingInfo] = createSignal<PendingInfo | null>(null);
	const [error, setError] = createSignal<string | null>(null);
	const [submitting, setSubmitting] = createSignal(false);

	onMount(async () => {
		// Try OAuth pending first, then email pending
		try {
			const oauthResponse = await fetch("/api/auth/oauth/pending", {
				credentials: "include",
			});
			if (oauthResponse.ok) {
				const data = (await oauthResponse.json()) as {
					provider: string;
					email?: string;
					name?: string;
				};
				setPendingInfo({ ...data, source: "oauth" });
				return;
			}
		} catch {
			// Continue to try email pending
		}

		try {
			const emailResponse = await fetch("/api/auth/email/pending", {
				credentials: "include",
			});
			if (emailResponse.ok) {
				const data = (await emailResponse.json()) as {
					provider: string;
					email?: string;
				};
				setPendingInfo({ ...data, source: "email" });
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
			// Use the appropriate endpoint based on the pending source
			const info = pendingInfo();
			const endpoint =
				info?.source === "email"
					? "/api/auth/email/complete"
					: "/api/auth/oauth/complete";

			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username }),
				credentials: "include",
			});

			const data = (await response.json()) as
				| {
						user: { id: number; username: string };
						needsPasskeySetup: boolean;
						claimed?: boolean;
				  }
				| { error: string };

			if (!response.ok) {
				setError((data as { error: string }).error || "Registration failed");
				return;
			}

			const result = data as {
				user: { id: number; username: string };
				needsPasskeySetup: boolean;
				claimed?: boolean;
			};
			props.onComplete(result.user, result.needsPasskeySetup);
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
