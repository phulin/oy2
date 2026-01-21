import { Button } from "@kobalte/core/button";
import { A } from "@solidjs/router";
import { createResource, For, Show } from "solid-js";
import type { PasskeyStatus } from "../types";
import "./ButtonStyles.css";
import "./SettingsScreen.css";

type SettingsScreenProps = {
	onSetupNotifications: () => void;
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
	const [status] = createResource(() =>
		props.api<PasskeyStatus>("/api/auth/passkey/status"),
	);

	const passkeys = () => status()?.passkeys ?? [];

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
					<Button class="btn-primary" onClick={props.onSetupNotifications}>
						Enable Notifications
					</Button>
				</div>
			</section>

			<section class="settings-section">
				<div class="settings-section-row">
					<div>
						<h3 class="settings-section-title">Passkeys</h3>
						<p class="settings-section-description">
							Manage the devices you can use to sign in.
						</p>
					</div>
					<A
						class="btn-primary settings-add-passkey"
						href="/settings/passkeys/new"
					>
						Add passkey
					</A>
				</div>

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
		</div>
	);
}
