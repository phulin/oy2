import { Button } from "@kobalte/core/button";
import { createSignal } from "solid-js";
import type { User } from "../types";
import "./ButtonStyles.css";
import "./AppHeader.css";

type AppHeaderProps = {
	user: User;
	onLogout: () => void;
	onSetupNotifications: () => void;
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
						<a class="app-user-action" href="/admin">
							Admin
						</a>
					) : null}
					<Button class="app-user-action" onClick={props.onSetupNotifications}>
						Enable Notifications
					</Button>
					<a class="app-user-action" href="/privacy">
						Privacy Policy
					</a>
					<Button class="app-user-action" onClick={props.onLogout}>
						Logout
					</Button>
				</div>
			) : null}
		</div>
	);
}
