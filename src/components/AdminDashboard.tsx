import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { User } from "../types";
import "./AdminDashboard.css";
import "./ButtonStyles.css";

type AdminActiveUser = {
	id: number;
	username: string;
	last_seen: number;
	has_auth_methods: boolean;
	push_subscriptions_count: number;
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
	openReportsCount: number;
	totalBlocksCount: number;
};

type AdminReport = {
	id: number;
	reporterUserId: number;
	targetUserId: number;
	reporterUsername: string;
	targetUsername: string;
	reason: string;
	details: string | null;
	status: string;
	createdAt: number;
};

type AdminBlock = {
	blockerUserId: number;
	blockedUserId: number;
	blockerUsername: string;
	blockedUsername: string;
	createdAt: number;
};

type AdminStatsResponse = {
	stats: AdminStats;
	activeUsers: AdminActiveUser[];
	recentReports: AdminReport[];
	recentBlocks: AdminBlock[];
	generatedAt: number;
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

	const formatTimestamp = (timestamp: number) =>
		new Date(timestamp * 1000).toLocaleString();

	const formatPercent = (value: number) => `${Math.round(value * 1000) / 10}%`;

	onMount(() => {
		void loadStats();
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
							<div class="admin-card card card-bordered">
								<p class="admin-label">Open reports</p>
								<p class="admin-value">{payload().stats.openReportsCount}</p>
							</div>
							<div class="admin-card card card-bordered">
								<p class="admin-label">Total blocks</p>
								<p class="admin-value">{payload().stats.totalBlocksCount}</p>
							</div>
						</div>

						<div class="admin-section stack">
							<div class="admin-section-header">
								<h2>Active sessions</h2>
								<span class="admin-meta">
									Updated {formatTimestamp(payload().generatedAt)}
								</span>
							</div>
							<table class="admin-table admin-table--sessions">
								<thead>
									<tr>
										<th>User</th>
										<th>Push</th>
										<th>Last seen</th>
									</tr>
								</thead>
								<tbody>
									<Show
										when={payload().activeUsers.length > 0}
										fallback={
											<tr>
												<td colspan="3">No active users.</td>
											</tr>
										}
									>
										{payload().activeUsers.map((activeUser) => (
											<tr>
												<td>
													<span class="admin-user">
														<span>{activeUser.username}</span>
														<Show when={activeUser.has_auth_methods}>
															<span
																class="admin-badge"
																role="img"
																aria-label="Authenticated"
																title="Authenticated"
															>
																<svg
																	class="admin-badge-icon"
																	viewBox="0 0 24 24"
																	aria-hidden="true"
																>
																	<path
																		d="M17 10V8a5 5 0 0 0-10 0v2H5v10h14V10h-2Zm-8-2a3 3 0 1 1 6 0v2H9V8Zm3 9a2 2 0 1 0-2-2 2 2 0 0 0 2 2Z"
																		fill="currentColor"
																	/>
																</svg>
															</span>
														</Show>
													</span>
												</td>
												<td>{activeUser.push_subscriptions_count}</td>
												<td>{formatTimestamp(activeUser.last_seen)}</td>
											</tr>
										))}
									</Show>
								</tbody>
							</table>
						</div>

						<div class="admin-section stack">
							<div class="admin-section-header">
								<h2>Recent reports</h2>
							</div>
							<table class="admin-table">
								<thead>
									<tr>
										<th>ID</th>
										<th>Reporter</th>
										<th>Target</th>
										<th>Reason</th>
										<th>Status</th>
										<th>Created</th>
									</tr>
								</thead>
								<tbody>
									<Show
										when={payload().recentReports.length > 0}
										fallback={
											<tr>
												<td colspan="6">No reports.</td>
											</tr>
										}
									>
										{payload().recentReports.map((report) => (
											<tr>
												<td>{report.id}</td>
												<td>{report.reporterUsername}</td>
												<td>{report.targetUsername}</td>
												<td class="admin-reason-cell">
													<strong>{report.reason}</strong>
													<Show when={report.details}>
														<p class="admin-inline-note">{report.details}</p>
													</Show>
												</td>
												<td>{report.status}</td>
												<td>{formatTimestamp(report.createdAt)}</td>
											</tr>
										))}
									</Show>
								</tbody>
							</table>
						</div>

						<div class="admin-section stack">
							<div class="admin-section-header">
								<h2>Recent blocks</h2>
							</div>
							<table class="admin-table">
								<thead>
									<tr>
										<th>Blocker</th>
										<th>Blocked</th>
										<th>Created</th>
									</tr>
								</thead>
								<tbody>
									<Show
										when={payload().recentBlocks.length > 0}
										fallback={
											<tr>
												<td colspan="3">No blocks.</td>
											</tr>
										}
									>
										{payload().recentBlocks.map((block) => (
											<tr>
												<td>{block.blockerUsername}</td>
												<td>{block.blockedUsername}</td>
												<td>{formatTimestamp(block.createdAt)}</td>
											</tr>
										))}
									</Show>
								</tbody>
							</table>
						</div>
					</>
				)}
			</Show>
		</div>
	);
}
