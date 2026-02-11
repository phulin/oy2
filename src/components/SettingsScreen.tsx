import { Button } from "@kobalte/core/button";
import { A } from "@solidjs/router";
import {
	createEffect,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import { registerPasskey } from "../passkeyClient";
import type { PasskeyStatus, User } from "../types";
import { AsyncButton } from "./AsyncButton";
import "./ButtonStyles.css";
import "./FormControls.css";
import "./SettingsScreen.css";

type SettingsScreenProps = {
	user: User;
	onSetupNotifications: () => Promise<void>;
	onDeleteAccount: () => Promise<void>;
	api: <T>(path: string, options?: RequestInit) => Promise<T>;
};

function formatTimestamp(value?: number | null) {
	if (!value) {
		return "Never";
	}
	return new Date(value * 1000).toLocaleString();
}

function formatLastUsed(value?: number | null) {
	if (!value) {
		return "Never used";
	}
	return `Last used ${formatTimestamp(value)}`;
}

export function SettingsScreen(props: SettingsScreenProps) {
	const [status, { refetch }] = createResource(() =>
		props.api<PasskeyStatus>("/api/auth/passkey/status"),
	);
	const [creating, setCreating] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [linkedEmail, setLinkedEmail] = createSignal(props.user.email ?? "");
	const [emailValue, setEmailValue] = createSignal(props.user.email ?? "");
	const [emailCode, setEmailCode] = createSignal("");
	const [emailStep, setEmailStep] = createSignal<"idle" | "code_sent">("idle");
	const [emailError, setEmailError] = createSignal<string | null>(null);
	const [emailMessage, setEmailMessage] = createSignal<string | null>(null);
	const [sendingEmail, setSendingEmail] = createSignal(false);
	const [verifyingEmail, setVerifyingEmail] = createSignal(false);
	const [deleteConfirmValue, setDeleteConfirmValue] = createSignal("");
	const [deleteError, setDeleteError] = createSignal<string | null>(null);
	const [deletingAccount, setDeletingAccount] = createSignal(false);

	createEffect(() => {
		const email = props.user.email ?? "";
		setLinkedEmail(email);
		setEmailValue(email);
	});

	const passkeys = () => status()?.passkeys ?? [];

	async function handleAddPasskey() {
		setCreating(true);
		setError(null);
		try {
			await registerPasskey();
			await refetch();
		} catch (err) {
			if ((err as Error).name === "NotAllowedError") {
				setError("Setup was cancelled. You can try again.");
			} else {
				setError((err as Error).message || "Setup failed. Please try again.");
			}
		} finally {
			setCreating(false);
		}
	}

	async function handleSendEmailCode() {
		setEmailError(null);
		setEmailMessage(null);
		setSendingEmail(true);
		try {
			const response = await props.api<{ status: string; email?: string }>(
				"/api/auth/email/add/send-code",
				{
					method: "POST",
					body: JSON.stringify({ email: emailValue() }),
				},
			);
			if (response.status === "already_set") {
				setEmailStep("idle");
				setLinkedEmail(emailValue());
				setEmailMessage("Email already linked.");
				return;
			}
			setEmailStep("code_sent");
			setEmailMessage("Verification code sent.");
		} catch (err) {
			setEmailError(err instanceof Error ? err.message : String(err));
		} finally {
			setSendingEmail(false);
		}
	}

	async function handleVerifyEmailCode() {
		setEmailError(null);
		setEmailMessage(null);
		setVerifyingEmail(true);
		try {
			const response = await props.api<{ status: string; email: string }>(
				"/api/auth/email/add/verify",
				{
					method: "POST",
					body: JSON.stringify({ code: emailCode() }),
				},
			);
			if (response.status === "email_updated") {
				setLinkedEmail(response.email);
				setEmailValue(response.email);
				setEmailCode("");
				setEmailStep("idle");
				setEmailMessage("Email added.");
			}
		} catch (err) {
			setEmailError(err instanceof Error ? err.message : String(err));
		} finally {
			setVerifyingEmail(false);
		}
	}

	async function handleDeleteAccount() {
		setDeleteError(null);
		if (deleteConfirmValue().trim() !== "DELETE") {
			setDeleteError('Type "DELETE" to confirm.');
			return;
		}
		setDeletingAccount(true);
		try {
			await props.onDeleteAccount();
		} catch (err) {
			setDeleteError(err instanceof Error ? err.message : String(err));
		} finally {
			setDeletingAccount(false);
		}
	}

	return (
		<div class="settings-screen">
			<header class="settings-header">
				<h2 class="settings-title">
					<A class="settings-back" href="/">
						←
					</A>
					<span>Settings</span>
				</h2>
			</header>

			<section class="settings-section">
				<div class="settings-section-row">
					<div>
						<h3 class="settings-section-title">Notifications</h3>
						<p class="settings-section-description">
							Enable push notifications for Oys.
						</p>
					</div>
					<AsyncButton class="btn-primary" onClick={props.onSetupNotifications}>
						Enable Notifications
					</AsyncButton>
				</div>
			</section>

			<section class="settings-section">
				<div class="settings-section-row">
					<div>
						<h3 class="settings-section-title">Email</h3>
						<p class="settings-section-description">
							Add an email so you can sign in without a passkey.
						</p>
					</div>
					<div class="settings-email-current">
						{linkedEmail() ? linkedEmail() : "No email linked"}
					</div>
				</div>

				<div class="settings-email-form">
					<label class="settings-email-label" for="settings-email-input">
						Email address
					</label>
					<input
						id="settings-email-input"
						class="app-text-input settings-email-input"
						type="email"
						autocomplete="email"
						placeholder="you@example.com"
						value={emailValue()}
						onInput={(event) => setEmailValue(event.currentTarget.value.trim())}
					/>
					<div class="settings-email-actions">
						<Button
							class="btn-primary"
							onClick={handleSendEmailCode}
							disabled={sendingEmail()}
						>
							{sendingEmail() ? "Sending..." : "Send code"}
						</Button>
					</div>
				</div>

				<Show when={emailStep() === "code_sent"}>
					<div class="settings-email-form settings-email-form-verify">
						<label class="settings-email-label" for="settings-email-code">
							Verification code
						</label>
						<input
							id="settings-email-code"
							class="app-text-input settings-email-input"
							inputmode="numeric"
							autocomplete="one-time-code"
							placeholder="123456"
							value={emailCode()}
							onInput={(event) => setEmailCode(event.currentTarget.value)}
						/>
						<div class="settings-email-actions">
							<Button
								class="btn-primary"
								onClick={handleVerifyEmailCode}
								disabled={verifyingEmail()}
							>
								{verifyingEmail() ? "Verifying..." : "Verify"}
							</Button>
							<Button
								class="btn-secondary"
								onClick={handleSendEmailCode}
								disabled={sendingEmail()}
							>
								Resend
							</Button>
						</div>
					</div>
				</Show>

				{emailError() && <p class="form-error">{emailError()}</p>}
				{emailMessage() && <p class="settings-message">{emailMessage()}</p>}
			</section>

			<section class="settings-section">
				<div class="settings-section-row">
					<div>
						<h3 class="settings-section-title">Passkeys</h3>
						<p class="settings-section-description">
							Manage the devices you can use to sign in.
						</p>
					</div>
					<Button
						class="btn-primary settings-add-passkey"
						onClick={handleAddPasskey}
						disabled={creating()}
					>
						{creating() ? "Adding..." : "Add passkey"}
					</Button>
				</div>
				{error() && <p class="form-error">{error()}</p>}

				<Show
					when={status()}
					fallback={<p class="settings-muted">Loading passkeys...</p>}
				>
					<Show
						when={passkeys().length > 0}
						fallback={<p class="settings-muted">No passkeys yet.</p>}
					>
						<ul class="settings-passkeys">
							<For each={passkeys()}>
								{(passkey) => (
									<li class="settings-passkey">
										<div class="settings-passkey-name">
											{passkey.device_name ?? "Unknown device"}
										</div>
										<div class="settings-passkey-meta">
											Added {formatTimestamp(passkey.created_at)}
										</div>
										<div class="settings-passkey-meta">
											{formatLastUsed(passkey.last_used_at)}
										</div>
									</li>
								)}
							</For>
						</ul>
					</Show>
				</Show>
			</section>

			<section class="settings-section settings-danger">
				<div class="settings-section-row">
					<div>
						<h3 class="settings-section-title">Delete Account</h3>
						<p class="settings-section-description">
							This permanently removes your account and all associated data.
						</p>
					</div>
				</div>

				<div class="settings-email-form">
					<label class="settings-email-label" for="settings-delete-confirm">
						Type DELETE to confirm
					</label>
					<input
						id="settings-delete-confirm"
						class="app-text-input settings-email-input"
						type="text"
						autocomplete="off"
						placeholder="DELETE"
						value={deleteConfirmValue()}
						onInput={(event) =>
							setDeleteConfirmValue(event.currentTarget.value)
						}
					/>
					<div class="settings-email-actions">
						<Button
							class="btn-secondary settings-delete-button"
							onClick={handleDeleteAccount}
							disabled={deletingAccount()}
						>
							{deletingAccount() ? "Deleting..." : "Delete account"}
						</Button>
					</div>
				</div>
				{deleteError() && <p class="form-error">{deleteError()}</p>}
			</section>
		</div>
	);
}
