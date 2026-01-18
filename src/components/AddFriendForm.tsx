import { Button } from "@kobalte/core/button";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Friend, SearchUser, User } from "../types";
import { TouchTooltip } from "./TouchTooltip";
import "./ButtonStyles.css";
import "./FormControls.css";
import "./AddFriendForm.css";

type AddFriendFormProps = {
	api: <T>(endpoint: string, options?: RequestInit) => Promise<T>;
	currentUser: () => User | null;
	friends: () => Friend[];
};

export function AddFriendForm(props: AddFriendFormProps) {
	const [results, setResults] = createSignal<SearchUser[]>([]);
	const [query, setQuery] = createSignal("");
	const [mutualUsernames, setMutualUsernames] = createSignal<
		Record<number, string[]>
	>({});
	let debounce: ReturnType<typeof setTimeout> | undefined;
	const friendIds = createMemo(
		() => new Set(props.friends().map((friend) => friend.id)),
	);
	const trimmedQuery = createMemo(() => query().trim());
	const isSuggesting = createMemo(() => trimmedQuery().length === 0);

	createEffect(() => {
		const value = trimmedQuery();
		clearTimeout(debounce);
		if (value.length === 0) {
			debounce = setTimeout(async () => {
				try {
					const { users } = await props.api<{ users: SearchUser[] }>(
						"/api/users/suggested",
					);
					if (trimmedQuery().length !== 0) {
						return;
					}
					setResults(users);
					const suggestedIds = users
						.filter((user) => user.mutuals && user.mutuals > 0)
						.map((user) => user.id);
					if (suggestedIds.length === 0) {
						setMutualUsernames({});
						return;
					}
					const { mutuals } = await props.api<{
						mutuals: Record<number, string[]>;
					}>("/api/users/suggested/mutuals", {
						method: "POST",
						body: JSON.stringify({ userIds: suggestedIds }),
					});
					if (trimmedQuery().length !== 0) {
						return;
					}
					setMutualUsernames(mutuals);
				} catch (err) {
					console.error("Suggestions failed:", err);
				}
			}, 200);
			return;
		}

		setMutualUsernames({});
		if (value.length < 2) {
			setResults([]);
			return;
		}

		debounce = setTimeout(async () => {
			try {
				const { users } = await props.api<{ users: SearchUser[] }>(
					`/api/users/search?q=${encodeURIComponent(value)}`,
				);
				setResults(users);
			} catch (err) {
				console.error("Search failed:", err);
			}
		}, 300);
	});

	async function addFriend(friendId: number) {
		try {
			await props.api("/api/friends", {
				method: "POST",
				body: JSON.stringify({ friendId }),
			});
			setResults((prev) =>
				prev.map((user) =>
					user.id === friendId ? { ...user, added: true } : user,
				),
			);
		} catch (err) {
			alert((err as Error).message);
		}
	}

	const showPrompt = () => query().trim().length < 2;
	const emptyStateMessage = () => {
		if (isSuggesting()) {
			return "No suggested friends yet";
		}
		if (showPrompt()) {
			return "Search for friends to add";
		}
		return "No users found";
	};

	return (
		<>
			<form onSubmit={(event) => event.preventDefault()}>
				<input
					type="text"
					placeholder="Search username"
					autocomplete="off"
					value={query()}
					onInput={(event) => setQuery(event.currentTarget.value)}
					class="app-text-input"
				/>
			</form>
			<div class="add-friend-list stack">
				<Show
					when={results().length > 0}
					fallback={
						<p class="add-friend-empty-state empty-state">
							{emptyStateMessage()}
						</p>
					}
				>
					<Show when={isSuggesting()}>
						<div class="add-friend-list-header">Suggested friends</div>
					</Show>
					<For
						each={results().filter(
							(user) => user.id !== props.currentUser()?.id,
						)}
					>
						{(user) => (
							<div class="add-friend-list-item card">
								<div class="add-friend-list-item-content stack stack-sm">
									<div class="add-friend-list-item-title item-title">
										{user.username}
									</div>
									<Show when={user.mutuals && user.mutuals > 0}>
										<TouchTooltip
											triggerClass="add-friend-list-item-meta mutuals-trigger"
											contentClass="mutuals-popover"
											trigger={
												<>
													{user.mutuals} mutual
													{user.mutuals === 1 ? "" : "s"}
												</>
											}
											content={
												<Show
													when={(mutualUsernames()[user.id] ?? []).length > 0}
													fallback={
														<span class="mutuals-loading">
															Loading mutuals...
														</span>
													}
												>
													{(mutualUsernames()[user.id] ?? []).join(", ")}
												</Show>
											}
										/>
									</Show>
								</div>
								<Show
									when={!friendIds().has(user.id)}
									fallback={
										<span class="add-friend-status">Already friends</span>
									}
								>
									<Button
										class="btn-secondary"
										disabled={user.added}
										onClick={() => addFriend(user.id)}
									>
										{user.added ? "Added!" : "Add Friend"}
									</Button>
								</Show>
							</div>
						)}
					</For>
				</Show>
			</div>
		</>
	);
}
