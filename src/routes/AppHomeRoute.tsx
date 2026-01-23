import { Tabs } from "@kobalte/core";
import { createEffect } from "solid-js";
import { useAppContext } from "../AppContext";
import { AddFriendForm } from "../components/AddFriendForm";
import { AppHeader } from "../components/AppHeader";
import { FriendsList } from "../components/FriendsList";
import { OysList } from "../components/OysList";
import { Screen } from "../components/Screen";
import { SwipeableTabs } from "../components/SwipeableTabs";
import type { User } from "../types";

const tabOrder = ["friends", "oys", "add"] as const;

export function AppHomeRoute() {
	const {
		currentUser,
		logout,
		friendsWithLastOy,
		loadingFriends,
		friends,
		loadingLastOyInfo,
		lastOyInfo,
		sendOy,
		sendLo,
		oys,
		openLocations,
		toggleLocation,
		hasMoreOys,
		loadingMoreOys,
		loadingOys,
		loadOysPage,
		refresh,
		refreshing,
		tab,
		setTab,
		api,
		handleFriendAdded,
	} = useAppContext();

	let hasUpdatedHash = false;
	const hashValue = window.location.hash.replace(/^#/, "");
	const hashParams = new URLSearchParams(hashValue);
	const initialHashUsesParam = hashParams.has("tab");

	createEffect(() => {
		const currentTab = tab();
		if (!hasUpdatedHash) {
			hasUpdatedHash = true;
			return;
		}
		if (currentTab === "friends") {
			if (window.location.hash) {
				history.replaceState(
					null,
					"",
					window.location.pathname + window.location.search,
				);
			}
			return;
		}
		const hash = initialHashUsesParam ? `tab=${currentTab}` : currentTab;
		if (window.location.hash !== `#${hash}`) {
			history.replaceState(
				null,
				"",
				`${window.location.pathname}${window.location.search}#${hash}`,
			);
		}
	});

	const user = () => currentUser() as User;

	return (
		<Screen>
			<AppHeader user={user()} onLogout={logout} />

			<Tabs.Root value={tab()} onChange={setTab} class="app-tabs-root">
				<Tabs.List class="app-tabs">
					<Tabs.Trigger class="app-tab" value="friends">
						Friends
					</Tabs.Trigger>
					<Tabs.Trigger class="app-tab" value="oys">
						Oys
					</Tabs.Trigger>
					<Tabs.Trigger class="app-tab" value="add">
						Add Friend
					</Tabs.Trigger>
				</Tabs.List>

				<SwipeableTabs
					order={tabOrder}
					value={tab}
					onChange={setTab}
					onRefresh={refresh}
					refreshing={refreshing}
				>
					<Tabs.Content value="friends">
						<FriendsList
							friends={friendsWithLastOy()}
							currentUserId={user().id}
							loading={() => loadingFriends() && friends().length === 0}
							loadingLastOy={() =>
								loadingLastOyInfo() && lastOyInfo().length === 0
							}
							onSendOy={sendOy}
							onSendLo={sendLo}
						/>
					</Tabs.Content>

					<Tabs.Content value="oys">
						<OysList
							oys={oys()}
							currentUserId={user().id}
							openLocations={openLocations}
							onToggleLocation={toggleLocation}
							hasMore={hasMoreOys}
							loadingMore={loadingMoreOys}
							loading={loadingOys}
							onLoadMore={() => loadOysPage()}
						/>
					</Tabs.Content>

					<Tabs.Content value="add">
						<AddFriendForm
							api={api}
							currentUser={currentUser}
							friends={friends}
							onFriendAdded={handleFriendAdded}
						/>
					</Tabs.Content>
				</SwipeableTabs>
			</Tabs.Root>
		</Screen>
	);
}
