import { For, Show } from "solid-js";
import type { Friend } from "../types";
import "./FriendsList.css";

type FriendsListProps = {
	friends: Friend[];
	onSendOy: (friendId: number) => void;
	onSendLo: (friendId: number) => void;
};

export function FriendsList(props: FriendsListProps) {
	return (
		<div class="friends-list">
			<Show
				when={props.friends.length > 0}
				fallback={<p class="friends-empty-state">No friends yet. Add some!</p>}
			>
				<For each={props.friends}>
					{(friend) => (
						<div class="friends-list-item">
							<div class="friends-list-item-content">
								<div class="friends-list-item-title">{friend.username}</div>
							</div>
							<div class="friends-list-item-actions">
								<button type="button" onClick={() => props.onSendOy(friend.id)}>
									Oy!
								</button>
								<button type="button" onClick={() => props.onSendLo(friend.id)}>
									Lo!
								</button>
							</div>
						</div>
					)}
				</For>
			</Show>
		</div>
	);
}
