import { Button } from "@kobalte/core/button";
import type { User } from "../types";
import "./ButtonStyles.css";
import "./AppHeader.css";

type AppHeaderProps = {
	user: User;
	onLogout: () => void;
};

export function AppHeader(props: AppHeaderProps) {
	return (
		<div class="app-header">
			<h1 class="app-title">Oy</h1>
			<div class="app-user-info">
				<span>{props.user.username}</span>
				<Button class="btn-text" onClick={props.onLogout}>
					Logout
				</Button>
			</div>
		</div>
	);
}
