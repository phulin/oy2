import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { FriendWithLastOy } from "../types";
import { formatTime } from "../utils";
import { AsyncButton } from "./AsyncButton";
import "./ButtonStyles.css";
import "./FriendsList.css";
import { TouchTooltip } from "./TouchTooltip";

type FriendsListProps = {
	friends: FriendWithLastOy[];
	currentUserId: number;
	loading: () => boolean;
	loadingLastOy: () => boolean;
	onSendOy: (friendId: number) => Promise<void>;
	onSendLo: (friendId: number) => Promise<void>;
};

export function FriendsList(props: FriendsListProps) {
	const [timeTick, setTimeTick] = createSignal(Date.now());
	const intervalId = window.setInterval(() => {
		setTimeTick(Date.now());
	}, 60000);
	onCleanup(() => window.clearInterval(intervalId));
	const skeletonItems = () => Array.from({ length: 4 });
	const sortedFriends = createMemo(() =>
		[...props.friends].sort(
			(a, b) => (b.last_oy_created_at ?? -1) - (a.last_oy_created_at ?? -1),
		),
	);
	const formatRelativeTime = (timestamp: number) => {
		timeTick();
		return formatTime(timestamp);
	};

	return (
		<div class="friends-list stack">
			<Show
				when={props.friends.length > 0}
				fallback={
					props.loading() ? (
						<div class="friends-skeleton stack" aria-hidden="true">
							<For each={skeletonItems()}>
								{() => (
									<div class="friends-skeleton-card">
										<div class="friends-skeleton-shimmer" />
									</div>
								)}
							</For>
						</div>
					) : (
						<p class="friends-empty-state empty-state">
							No friends yet. Add some!
						</p>
					)
				}
			>
				<For each={sortedFriends()}>
					{(friend) => {
						const lastOyCreatedAt = friend.last_oy_created_at;
						const lastOyDirection =
							friend.last_oy_from_user_id === props.currentUserId ? "↗" : "↙";

						return (
							<div class="friends-list-item card">
								<div class="friends-list-item-content stack stack-sm">
									<div class="friends-list-item-title item-title">
										{friend.username}
									</div>
									<Show
										when={lastOyCreatedAt !== null}
										fallback={
											<Show when={props.loadingLastOy()}>
												<div class="friends-list-item-subtitle item-subtitle">
													Loading...
												</div>
											</Show>
										}
									>
										<div class="friends-list-item-subtitle item-subtitle">
											{lastOyDirection}{" "}
											{formatRelativeTime(lastOyCreatedAt as number)}
											<Show when={friend.streak >= 2}>
												<TouchTooltip
													triggerClass="streak-trigger"
													contentClass="streak-popover"
													trigger="🔥"
													content={`${friend.streak}-day streak!`}
												/>
											</Show>
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
