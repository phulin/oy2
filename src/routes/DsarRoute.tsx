import { onCleanup, onMount } from "solid-js";
import { useAppContext } from "../AppContext";
import { AppHeader } from "../components/AppHeader";
import { DsarRequestScreen } from "../components/DsarRequestScreen";
import { Screen } from "../components/Screen";
import type { User } from "../types";

export function DsarRoute() {
	const { currentUser, logout, api } = useAppContext();
	const user = () => currentUser() as User;

	onMount(() => {
		const previousTitle = document.title;
		document.title = "DSAR Request - Oy";
		onCleanup(() => {
			document.title = previousTitle;
		});
	});

	return (
		<Screen>
			<AppHeader backHref="/settings" user={user()} onLogout={logout} />
			<DsarRequestScreen api={api} />
		</Screen>
	);
}
