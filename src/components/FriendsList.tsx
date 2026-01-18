import { Tooltip } from "@kobalte/core/tooltip";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
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
	const [timeTick, setTimeTick] = createSignal(Date.now());
	const intervalId = window.setInterval(() => {
		setTimeTick(Date.now());
	}, 60000);
	onCleanup(() => window.clearInterval(intervalId));

	const skeletonItems = () => Array.from({ length: 4 });
	const sortedFriends = createMemo(() =>
		[...props.friends].sort(
			(a, b) => (b.last_yo_created_at ?? -1) - (a.last_yo_created_at ?? -1),
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
						const lastYoCreatedAt = friend.last_yo_created_at;
						const lastYoDirection =
							friend.last_yo_from_user_id === props.currentUserId ? "↗" : "↙";
						const [streakOpen, setStreakOpen] = createSignal(false);
						const [streakLock, setStreakLock] = createSignal(false);

						return (
							<div class="friends-list-item card">
								<div class="friends-list-item-content stack stack-sm">
									<div class="friends-list-item-title item-title">
										{friend.username}
									</div>
									<Show when={lastYoCreatedAt !== null}>
										<div class="friends-list-item-subtitle item-subtitle">
											{lastYoDirection}{" "}
											{formatRelativeTime(lastYoCreatedAt as number)}
											<Show when={friend.streak >= 2}>
												<Tooltip
													open={streakOpen()}
													onOpenChange={(isOpen) => {
														if (streakLock()) {
															if (isOpen) {
																setStreakOpen(true);
															}
															return;
														}
														setStreakOpen(isOpen);
													}}
													openDelay={100}
												>
													<Tooltip.Trigger
														as="button"
														type="button"
														class="streak-trigger"
														onPointerDown={(event) => {
															if (event.pointerType === "touch") {
																setStreakLock(true);
																setStreakOpen((open) => {
																	const nextOpen = !open;
																	if (!nextOpen) {
																		setStreakLock(false);
																	}
																	return nextOpen;
																});
															}
														}}
													>
														🔥
													</Tooltip.Trigger>
													<Tooltip.Portal>
														<Tooltip.Content
															class="streak-popover"
															onPointerDownOutside={(event) => {
																if (
																	event.detail.originalEvent.pointerType ===
																	"touch"
																) {
																	setStreakLock(false);
																	setStreakOpen(false);
																}
															}}
														>
															{friend.streak}-day streak!
														</Tooltip.Content>
													</Tooltip.Portal>
												</Tooltip>
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
