import { Button } from "@kobalte/core/button";
import { createSignal } from "solid-js";
import { registerPasskey } from "../passkeyClient";
import { Screen } from "./Screen";
import "./ButtonStyles.css";
import "./LoginScreen.css";

type PasskeySetupScreenProps = {
	onComplete: () => void;
	onSkip: () => void;
};

export function PasskeySetupScreen(props: PasskeySetupScreenProps) {
	const [setting, setSetting] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	async function handleSetup() {
		setSetting(true);
		setError(null);

		try {
			await registerPasskey();
			props.onComplete();
		} catch (err) {
			if ((err as Error).name === "NotAllowedError") {
				setError("Setup was cancelled. You can try again or skip for now.");
			} else {
				setError((err as Error).message || "Setup failed. Please try again.");
			}
		} finally {
			setSetting(false);
		}
	}

	return (
		<Screen>
			<div class="passkey-setup">
				<div class="passkey-icon">
					<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M12 1C8.14 1 5 4.14 5 8c0 2.38 1.19 4.47 3 5.74V17a1 1 0 001 1h1v2a1 1 0 001 1h2a1 1 0 001-1v-2h1a1 1 0 001-1v-3.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm0 2c2.76 0 5 2.24 5 5 0 1.64-.81 3.09-2.03 4h-5.94C7.81 11.09 7 9.64 7 8c0-2.76 2.24-5 5-5z" />
					</svg>
				</div>

				<h2 class="passkey-title">Set Up Quick Login</h2>
				<p class="passkey-description">
					Use a passkey to sign in instantly next time. Your passkey syncs
					securely across your devices.
				</p>

				{error() && <p class="form-error">{error()}</p>}

				<div class="passkey-buttons">
					<Button
						class="btn-primary"
						onClick={handleSetup}
						disabled={setting()}
					>
						{setting() ? "Setting up..." : "Set up passkey"}
					</Button>

					<button
						type="button"
						class="passkey-skip"
						onClick={props.onSkip}
						disabled={setting()}
					>
						Skip for now
					</button>
				</div>
			</div>
		</Screen>
	);
}
