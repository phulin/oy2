import type { Accessor, Setter } from "solid-js";
import { createContext, useContext } from "solid-js";
import type { Friend, FriendWithLastOy, LastOyInfo, Oy, User } from "./types";

export type AppContextValue = {
	currentUser: Accessor<User | null>;
	friends: Accessor<Friend[]>;
	friendsWithLastOy: Accessor<FriendWithLastOy[]>;
	lastOyInfo: Accessor<LastOyInfo[]>;
	oys: Accessor<Oy[]>;
	openLocations: Accessor<Set<number>>;
	loadingFriends: Accessor<boolean>;
	loadingLastOyInfo: Accessor<boolean>;
	loadingOys: Accessor<boolean>;
	loadingMoreOys: Accessor<boolean>;
	hasMoreOys: Accessor<boolean>;
	tab: Accessor<string>;
	setTab: Setter<string>;
	api: <T>(path: string, options?: RequestInit) => Promise<T>;
	logout: () => void;
	handleSetupNotifications: () => void;
	sendOy: (toUserId: number) => Promise<void>;
	sendLo: (toUserId: number) => Promise<void>;
	toggleLocation: (id: number) => void;
	loadOysPage: (options?: { reset?: boolean }) => Promise<void>;
	handleFriendAdded: (friend: Friend) => void;
	passkeyAddComplete: () => void;
	passkeyAddCancel: () => void;
};

const AppContext = createContext<AppContextValue>();

export function useAppContext() {
	const context = useContext(AppContext);
	if (!context) {
		throw new Error("AppContext not found");
	}
	return context;
}

export { AppContext };
