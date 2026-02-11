import { onCleanup, onMount } from "solid-js";
import { useAppContext } from "../AppContext";
import { AppHeader } from "../components/AppHeader";
import { FriendProfileCardsScreen } from "../components/FriendProfileCardsScreen";
import { Screen } from "../components/Screen";
import type { User } from "../types";

export function FriendCardsRoute() {
	const { currentUser, logout, api, unfriend, blockUser, reportUser } =
		useAppContext();
	const user = () => currentUser() as User;

	onMount(() => {
		const previousTitle = document.title;
		document.title = "Friends - Oy";
		onCleanup(() => {
			document.title = previousTitle;
		});
	});

	return (
		<Screen>
			<AppHeader
				backHref="/"
				user={user()}
				onLogout={logout}
				class="friend-cards-sticky-header"
			/>
			<FriendProfileCardsScreen
				api={api}
				onUnfriend={unfriend}
				onBlock={blockUser}
				onReport={reportUser}
			/>
		</Screen>
	);
}
