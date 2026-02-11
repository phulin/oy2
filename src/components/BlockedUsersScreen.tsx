import { Button } from "@kobalte/core/button";
import { createResource, createSignal, For, Show } from "solid-js";
import type { BlockedUser } from "../types";
import "./BlockedUsersScreen.css";
import "./ButtonStyles.css";

type BlockedUsersScreenProps = {
	api: <T>(path: string, options?: RequestInit) => Promise<T>;
};

export function BlockedUsersScreen(props: BlockedUsersScreenProps) {
	const [pendingUnblockId, setPendingUnblockId] = createSignal<number | null>(
		null,
	);
	const [error, setError] = createSignal<string | null>(null);
	const [statusMessage, setStatusMessage] = createSignal<string | null>(null);
	const [blockedUsers, { mutate, refetch }] = createResource(async () => {
		const result = await props.api<{ users: BlockedUser[] }>(
			"/api/users/blocked",
		);
		return result.users;
	});

	async function handleUnblock(user: BlockedUser) {
		setError(null);
		setStatusMessage(null);
		setPendingUnblockId(user.id);
		try {
			await props.api(`/api/users/block/${user.id}`, { method: "DELETE" });
			mutate((prev) => (prev ?? []).filter((item) => item.id !== user.id));
			setStatusMessage(`${user.username} has been unblocked.`);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setPendingUnblockId(null);
		}
	}

	return (
		<div class="blocked-users-screen stack">
			<p class="blocked-users-description">
				Users you block are removed from your friends and cannot send you Oys.
			</p>
			<Show when={error()}>
				{(message) => <p class="form-error">{message()}</p>}
			</Show>
			<Show when={statusMessage()}>
				{(message) => <p class="blocked-users-status">{message()}</p>}
			</Show>

			<Show
				when={blockedUsers()}
				fallback={<p class="blocked-users-status">Loading blocked users...</p>}
			>
				{(users) => (
					<Show
						when={users().length > 0}
						fallback={<p class="blocked-users-status">No blocked users.</p>}
					>
						<ul class="blocked-users-list">
							<For each={users()}>
								{(user) => (
									<li class="blocked-users-item">
										<div class="blocked-users-item-name">{user.username}</div>
										<Button
											class="btn-secondary blocked-users-item-action"
											onClick={() => void handleUnblock(user)}
											disabled={pendingUnblockId() === user.id}
										>
											{pendingUnblockId() === user.id
												? "Unblocking..."
												: "Unblock"}
										</Button>
									</li>
								)}
							</For>
						</ul>
					</Show>
				)}
			</Show>
			<Button
				class="btn-secondary blocked-users-refresh"
				onClick={() => void refetch()}
			>
				Refresh
			</Button>
		</div>
	);
}
