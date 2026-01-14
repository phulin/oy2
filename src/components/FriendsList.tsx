import { For, Show } from "solid-js";
import type { FriendWithLastYo } from "../types";
import { AsyncButton } from "./AsyncButton";
import { formatTime } from "../utils";
import "./ButtonStyles.css";
import "./FriendsList.css";

type FriendsListProps = {
	friends: FriendWithLastYo[];
	onSendOy: (friendId: number) => Promise<void>;
	onSendLo: (friendId: number) => Promise<void>;
};

export function FriendsList(props: FriendsListProps) {
	return (
		<div class="friends-list">
			<Show
				when={props.friends.length > 0}
				fallback={<p class="friends-empty-state">No friends yet. Add some!</p>}
			>
				<For each={props.friends}>
					{(friend) => {
						const lastYoCreatedAt = friend.last_yo_created_at;

						return (
							<div class="friends-list-item">
								<div class="friends-list-item-content">
									<div class="friends-list-item-title">{friend.username}</div>
									<Show when={lastYoCreatedAt !== null}>
										<div class="friends-list-item-subtitle">
											{formatTime(lastYoCreatedAt as number)}
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
