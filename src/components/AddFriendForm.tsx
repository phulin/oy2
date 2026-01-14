import { Button } from "@kobalte/core/button";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Friend, SearchUser, User } from "../types";
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
	let debounce: ReturnType<typeof setTimeout> | undefined;
	const friendIds = createMemo(
		() => new Set(props.friends().map((friend) => friend.id)),
	);

	createEffect(() => {
		const value = query().trim();
		clearTimeout(debounce);
		if (value.length < 2) {
			setResults([]);
			return;
		}

		debounce = setTimeout(async () => {
			try {
				const { users } = await props.api<{ users: SearchUser[] }>(
					`/api/users/search?q=${encodeURIComponent(value)}`,
				);
				setResults(users || []);
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
			<div class="add-friend-list">
				<Show
					when={results().length > 0}
					fallback={
						<p class="add-friend-empty-state">
							{showPrompt() ? "Search for friends to add" : "No users found"}
						</p>
					}
				>
					<For
						each={results().filter(
							(user) => user.id !== props.currentUser()?.id,
						)}
					>
						{(user) => (
							<div class="add-friend-list-item">
								<div class="add-friend-list-item-content">
									<div class="add-friend-list-item-title">{user.username}</div>
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
