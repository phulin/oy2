import { onCleanup, onMount } from "solid-js";
import { useAppContext } from "../AppContext";
import { AppHeader } from "../components/AppHeader";
import { BlockedUsersScreen } from "../components/BlockedUsersScreen";
import { Screen } from "../components/Screen";
import type { User } from "../types";

export function BlockedUsersRoute() {
	const { currentUser, logout, api } = useAppContext();
	const user = () => currentUser() as User;

	onMount(() => {
		const previousTitle = document.title;
		document.title = "Blocked Users - Oy";
		onCleanup(() => {
			document.title = previousTitle;
		});
	});

	return (
		<Screen>
			<AppHeader backHref="/settings" user={user()} onLogout={logout} />
			<BlockedUsersScreen api={api} />
		</Screen>
	);
}
