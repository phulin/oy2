import { Button } from "@kobalte/core/button";
import { A } from "@solidjs/router";
import { createSignal } from "solid-js";
import { appLogoText } from "../branding";
import type { User } from "../types";
import "./ButtonStyles.css";
import "./AppHeader.css";

type AppHeaderProps = {
	user: User;
	onLogout: () => void;
	class?: string;
	backHref?: string;
};

export function AppHeader(props: AppHeaderProps) {
	const [menuOpen, setMenuOpen] = createSignal(false);
	const hasBackLink = Boolean(props.backHref);
	const backHref = props.backHref ?? "/";

	return (
		<div class={`app-header ${props.class ?? ""}`.trim()}>
			<div
				class={`app-header-row ${hasBackLink ? "app-header-row-back" : ""}`.trim()}
			>
				{hasBackLink ? (
					<A class="app-back-link" href={backHref}>
						<span aria-hidden="true">←</span>
						<span>Back</span>
					</A>
				) : null}
				<h1 class="app-title">{appLogoText}</h1>
				<button
					class="app-user-trigger"
					type="button"
					onClick={() => setMenuOpen((open) => !open)}
				>
					{props.user.username}
				</button>
			</div>
			{menuOpen() ? (
				<div class="app-user-panel">
					{props.user.admin ? (
						<A class="app-user-action" href="/admin">
							Admin
						</A>
					) : null}
					<A class="app-user-action" href="/settings">
						Settings
					</A>
					<A class="app-user-action" href="/legal">
						Legal
					</A>
					<Button class="app-user-action" onClick={props.onLogout}>
						Logout
					</Button>
				</div>
			) : null}
		</div>
	);
}
