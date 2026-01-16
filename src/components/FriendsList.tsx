import { For, Show } from "solid-js";
import type { FriendWithLastYo } from "../types";
import { formatTime } from "../utils";
import { AsyncButton } from "./AsyncButton";
import "./ButtonStyles.css";
import "./FriendsList.css";

type FriendsListProps = {
	friends: FriendWithLastYo[];
	currentUserId: number;
	loading: () => boolean;
	onSendOy: (friendId: number) => Promise<void>;
	onSendLo: (friendId: number) => Promise<void>;
};

export function FriendsList(props: FriendsListProps) {
	const skeletonItems = () => Array.from({ length: 4 });
	return (
		<div class="friends-list">
			<Show
				when={props.friends.length > 0}
				fallback={
					props.loading() ? (
						<div class="friends-skeleton" aria-hidden="true">
							<For each={skeletonItems()}>
								{() => (
									<div class="friends-skeleton-card">
										<div class="friends-skeleton-shimmer" />
									</div>
								)}
							</For>
						</div>
					) : (
						<p class="friends-empty-state">No friends yet. Add some!</p>
					)
				}
			>
				<For each={props.friends}>
					{(friend) => {
						const lastYoCreatedAt = friend.last_yo_created_at;
						const lastYoDirection =
							friend.last_yo_from_user_id === props.currentUserId ? "→" : "←";

						return (
							<div class="friends-list-item">
								<div class="friends-list-item-content">
									<div class="friends-list-item-title">{friend.username}</div>
									<Show when={lastYoCreatedAt !== null}>
										<div class="friends-list-item-subtitle">
											{lastYoDirection} {formatTime(lastYoCreatedAt as number)}
										</div>
									</Show>
								</div>
								<div class="friends-list-item-actions">
									<AsyncButton
										class="btn-oy"
										onClick={() => props.onSendOy(friend.id)}
									>
										Oy!
									</AsyncButton>
									<AsyncButton
										class="btn-lo"
										onClick={() => props.onSendLo(friend.id)}
									>
										Lo!
									</AsyncButton>
								</div>
							</div>
						);
					}}
				</For>
			</Show>
		</div>
	);
}
