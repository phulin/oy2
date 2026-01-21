import { Button } from "@kobalte/core/button";
import { A } from "@solidjs/router";
import { createSignal } from "solid-js";
import type { User } from "../types";
import "./ButtonStyles.css";
import "./AppHeader.css";

type AppHeaderProps = {
	user: User;
	onLogout: () => void;
};

export function AppHeader(props: AppHeaderProps) {
	const [menuOpen, setMenuOpen] = createSignal(false);

	return (
		<div class="app-header">
			<div class="app-header-row">
				<h1 class="app-title">Oy</h1>
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
					<A class="app-user-action" href="/privacy">
						Privacy
					</A>
					<A class="app-user-action" href="/terms">
						Terms
					</A>
					<Button class="app-user-action" onClick={props.onLogout}>
						Logout
					</Button>
				</div>
			) : null}
		</div>
	);
}
