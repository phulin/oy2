import { Button } from "@kobalte/core/button";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Oy, OyPayload } from "../types";
import { formatTime } from "../utils";
import { LocationMap } from "./LocationMap";
import "./OysList.css";

type OysListProps = {
	oys: Oy[];
	currentUserId: number;
	openLocations: () => Set<number>;
	onToggleLocation: (oyId: number) => void;
	hasMore: () => boolean;
	loadingMore: () => boolean;
	loading: () => boolean;
	onLoadMore: () => void;
};

export function OysList(props: OysListProps) {
	const [timeTick, setTimeTick] = createSignal(Date.now());
	const intervalId = window.setInterval(() => {
		setTimeTick(Date.now());
	}, 60000);
	onCleanup(() => window.clearInterval(intervalId));

	let sentinel: HTMLDivElement | undefined;
	const setSentinel = (el: HTMLDivElement) => {
		sentinel = el;
	};

	onMount(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting && props.hasMore()) {
					props.onLoadMore();
				}
			},
			{ rootMargin: "200px" },
		);

		if (sentinel) {
			observer.observe(sentinel);
		}

		onCleanup(() => {
			observer.disconnect();
		});
	});

	const formatRelativeTime = (timestamp: number) => {
		timeTick();
		return formatTime(timestamp);
	};

	return (
		<div class="oys-list stack">
			<Show
				when={props.oys.length > 0}
				fallback={
					<p class="oys-empty-state empty-state">
						{props.loading() ? "Loading Oys..." : "No Oys yet!"}
					</p>
				}
			>
				<For each={props.oys}>
					{(oy) => {
						const isLocation = oy.type === "lo" && !!oy.payload;
						const payload = oy.payload as OyPayload;
						const isOutbound = oy.from_user_id === props.currentUserId;
						const title = isOutbound
							? isLocation
								? `Lo to ${oy.to_username}`
								: `Oy to ${oy.to_username}`
							: isLocation
								? `Lo from ${oy.from_username}`
								: `Oy from ${oy.from_username}`;
						const isOpen = () => props.openLocations().has(oy.id);

						return (
							<Button
								class={`oys-list-item card${
									isLocation ? " oys-list-item-location" : ""
								}${isOutbound ? " oys-list-item-outbound" : " oys-list-item-inbound"}`}
								onClick={() => isLocation && props.onToggleLocation(oy.id)}
								data-oy-id={oy.id}
								aria-expanded={isLocation ? isOpen() : undefined}
								disabled={!isLocation}
							>
								<div class="oys-list-item-content stack stack-sm">
									<div
										class={`oys-list-item-header${isLocation ? " oys-list-item-header-location" : ""}`}
									>
										<div class="oys-list-item-text stack stack-sm">
											<div class="oys-list-item-title item-title">{title}</div>
											<div class="oys-list-item-subtitle item-subtitle">
												{formatRelativeTime(oy.created_at)}
											</div>
										</div>
										<Show when={isLocation}>
											<div class="oys-list-item-toggle-slot">
												<Button
													class="oys-location-toggle"
													onClick={(event) => {
														event.stopPropagation();
														props.onToggleLocation(oy.id);
													}}
												>
													<span class="oys-location-button">
														<span
															class={`oys-location-arrow${
																isOpen() ? " is-open" : ""
															}`}
														/>
													</span>
												</Button>
											</div>
										</Show>
									</div>
									<Show when={isLocation}>
										<div class="oys-list-item-map-slot">
											<div
												class={`oys-location-panel${isOpen() ? " open" : ""}`}
											>
												<LocationMap
													lat={payload.lat}
													lon={payload.lon}
													open={isOpen()}
												/>
											</div>
										</div>
									</Show>
								</div>
							</Button>
						);
					}}
				</For>
			</Show>
			<Show when={props.hasMore()}>
				<div class="oys-list-footer" ref={setSentinel}>
					<span class="oys-list-footer-text">
						{props.loadingMore() ? "Loading more..." : "Scroll for more"}
					</span>
				</div>
			</Show>
		</div>
	);
}
