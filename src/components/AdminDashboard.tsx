import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { User } from "../types";
import "./AdminDashboard.css";
import "./ButtonStyles.css";

type AdminActiveUser = {
	id: number;
	username: string;
	last_seen: number;
};

type AdminStats = {
	activeUsersCount: number;
	notificationsSent: number;
	deliveryAttempts: number;
	deliverySuccessCount: number;
	deliveryFailureCount: number;
	deliverySuccessRate: number;
	subscriptionsCount: number;
	usersCount: number;
};

type AdminStatsResponse = {
	stats: AdminStats;
	activeUsers: AdminActiveUser[];
	generatedAt: number;
};

type AdminPhoneAuthResponse = {
	enabled: boolean;
};

type AdminDashboardProps = {
	user: User;
	onLogout: () => void;
	api: <T>(endpoint: string, options?: RequestInit) => Promise<T>;
};

export function AdminDashboard(props: AdminDashboardProps) {
	const [data, setData] = createSignal<AdminStatsResponse | null>(null);
	const [error, setError] = createSignal<string | null>(null);
	const [loading, setLoading] = createSignal(true);
	const [phoneAuthEnabled, setPhoneAuthEnabled] = createSignal(true);
	const [settingsError, setSettingsError] = createSignal<string | null>(null);
	const [settingsLoading, setSettingsLoading] = createSignal(true);
	const [settingsSaving, setSettingsSaving] = createSignal(false);

	const loadStats = async () => {
		setLoading(true);
		setError(null);
		try {
			const response = await props.api<AdminStatsResponse>("/api/admin/stats");
			setData(response);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setData(null);
		} finally {
			setLoading(false);
		}
	};

	const loadPhoneAuthSetting = async () => {
		setSettingsLoading(true);
		setSettingsError(null);
		try {
			const response = await props.api<AdminPhoneAuthResponse>(
				"/api/admin/phone-auth",
			);
			setPhoneAuthEnabled(response.enabled);
		} catch (err) {
			setSettingsError(err instanceof Error ? err.message : String(err));
		} finally {
			setSettingsLoading(false);
		}
	};

	const updatePhoneAuthSetting = async (enabled: boolean) => {
		setSettingsSaving(true);
		setSettingsError(null);
		try {
			const response = await props.api<AdminPhoneAuthResponse>(
				"/api/admin/phone-auth",
				{
					method: "PUT",
					body: JSON.stringify({ enabled }),
				},
			);
			setPhoneAuthEnabled(response.enabled);
		} catch (err) {
			setSettingsError(err instanceof Error ? err.message : String(err));
		} finally {
			setSettingsSaving(false);
		}
	};

	const formatTimestamp = (timestamp: number) =>
		new Date(timestamp * 1000).toLocaleString();

	const formatPercent = (value: number) => `${Math.round(value * 1000) / 10}%`;

	onMount(() => {
		void loadStats();
		void loadPhoneAuthSetting();
		const interval = setInterval(loadStats, 300_000);
		onCleanup(() => clearInterval(interval));
	});

	return (
		<div class="admin-screen">
			<div class="admin-header">
				<div>
					<h1 class="admin-title">Admin</h1>
					<p class="admin-subtitle">
						Last 24 hours · Signed in as {props.user.username}
					</p>
				</div>
				<div class="admin-actions">
					<button class="btn-secondary" onClick={loadStats} type="button">
						Refresh
					</button>
					<button class="btn-text" onClick={props.onLogout} type="button">
						Logout
					</button>
				</div>
			</div>

			<Show when={loading()}>
				<p class="admin-status">Loading stats…</p>
			</Show>

			<Show when={error()}>
				<p class="admin-status admin-error">{error()}</p>
			</Show>

			<Show when={data()}>
				{(payload) => (
					<>
						<div class="admin-cards">
							<div class="admin-card card card-bordered">
								<p class="admin-label">Active users</p>
								<p class="admin-value">{payload().stats.activeUsersCount}</p>
							</div>
							<div class="admin-card card card-bordered">
								<p class="admin-label">Notifications sent</p>
								<p class="admin-value">{payload().stats.notificationsSent}</p>
							</div>
							<div class="admin-card card card-bordered">
								<p class="admin-label">Delivery success rate</p>
								<p class="admin-value">
									{formatPercent(payload().stats.deliverySuccessRate)}
								</p>
								<p class="admin-meta">
									{payload().stats.deliverySuccessCount} success ·{" "}
									{payload().stats.deliveryFailureCount} failed
								</p>
							</div>
							<div class="admin-card card card-bordered">
								<p class="admin-label">Delivery attempts</p>
								<p class="admin-value">{payload().stats.deliveryAttempts}</p>
								<p class="admin-meta">
									{payload().stats.subscriptionsCount} subscriptions ·{" "}
									{payload().stats.usersCount} users
								</p>
							</div>
						</div>

						<div class="admin-section stack">
							<div class="admin-section-header">
								<h2>Authentication</h2>
								<span class="admin-meta">
									Phone auth {phoneAuthEnabled() ? "enabled" : "disabled"}
								</span>
							</div>
							<div class="admin-toggle-row stack stack-md">
								<label class="admin-toggle">
									<span class="admin-toggle-copy stack stack-sm">
										<span class="admin-toggle-title item-title">
											Require phone verification
										</span>
										<span class="admin-meta">
											When disabled, users can sign in without SMS codes.
										</span>
									</span>
									<span class="admin-toggle-control">
										<input
											type="checkbox"
											checked={phoneAuthEnabled()}
											class="admin-toggle-input"
											disabled={settingsLoading() || settingsSaving()}
											onChange={(event) =>
												void updatePhoneAuthSetting(event.currentTarget.checked)
											}
										/>
										<span class="admin-toggle-slider" />
									</span>
								</label>
								<Show when={settingsLoading()}>
									<p class="admin-status">Loading settings…</p>
								</Show>
								<Show when={settingsError()}>
									<p class="admin-status admin-error">{settingsError()}</p>
								</Show>
							</div>
						</div>

						<div class="admin-section stack">
							<div class="admin-section-header">
								<h2>Active sessions</h2>
								<span class="admin-meta">
									Updated {formatTimestamp(payload().generatedAt)}
								</span>
							</div>
							<div class="admin-table">
								<div class="admin-table-row admin-table-head">
									<span>User</span>
									<span>Last seen</span>
								</div>
								<Show
									when={payload().activeUsers.length > 0}
									fallback={
										<div class="admin-table-row">
											<span>No active users.</span>
											<span />
										</div>
									}
								>
									{payload().activeUsers.map((activeUser) => (
										<div class="admin-table-row">
											<span>{activeUser.username}</span>
											<span>{formatTimestamp(activeUser.last_seen)}</span>
										</div>
									))}
								</Show>
							</div>
						</div>
					</>
				)}
			</Show>
		</div>
	);
}
