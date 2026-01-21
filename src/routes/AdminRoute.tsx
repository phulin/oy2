import { useAppContext } from "../AppContext";
import { AdminDashboard } from "../components/AdminDashboard";
import type { User } from "../types";

export function AdminRoute() {
	const { currentUser, api, logout } = useAppContext();
	const user = () => currentUser() as User;

	return <AdminDashboard user={user()} api={api} onLogout={logout} />;
}
