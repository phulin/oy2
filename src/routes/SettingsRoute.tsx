import { useAppContext } from "../AppContext";
import { AppHeader } from "../components/AppHeader";
import { Screen } from "../components/Screen";
import { SettingsScreen } from "../components/SettingsScreen";
import type { User } from "../types";

export function SettingsRoute() {
	const { currentUser, logout, handleSetupNotifications, api } =
		useAppContext();
	const user = () => currentUser() as User;

	return (
		<Screen>
			<AppHeader user={user()} onLogout={logout} />
			<SettingsScreen
				user={user()}
				onSetupNotifications={handleSetupNotifications}
				api={api}
			/>
		</Screen>
	);
}
