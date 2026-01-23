import type { JSX } from "solid-js";
import { createSignal } from "solid-js";
import { PullIndicator } from "./PullIndicator";
import "./SwipeableTabs.css";

type SwipeableTabsProps = {
	value: () => string;
	onChange: (next: string) => void;
	order: readonly string[];
	children: JSX.Element;
	onRefresh?: () => void;
	refreshing?: () => boolean;
};

export function SwipeableTabs(props: SwipeableTabsProps) {
	const [offset, setOffset] = createSignal(0);
	const [dragging, setDragging] = createSignal(false);
	const [pullOffset, setPullOffset] = createSignal(0);
	let start: { x: number; y: number } | null = null;
	let axis: "x" | "y" | null = null;
	let source: "touch" | "pointer" | null = null;

	const maxOffset = 84;
	const offsetScale = 0.4;
	const swipeThreshold = 45;
	const pullThreshold = 60;
	const maxPullOffset = 100;

	const isSwipeBlockedTarget = (target: HTMLElement | null) =>
		!!target?.closest(".oys-location-map");

	const isAtTop = () => {
		const scrollable = document.querySelector(".screen-content");
		return !scrollable || scrollable.scrollTop <= 0;
	};

	const updateOffset = (deltaX: number, deltaY: number) => {
		if (!axis) {
			axis = Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
		}
		if (axis === "x") {
			const scaled = deltaX * offsetScale;
			const clamped = Math.max(-maxOffset, Math.min(maxOffset, scaled));
			setOffset(clamped);
		} else if (axis === "y" && deltaY > 0 && isAtTop() && props.onRefresh) {
			const scaled = deltaY * offsetScale;
			const clamped = Math.min(maxPullOffset, scaled);
			setPullOffset(clamped);
		}
	};

	const finishSwipe = (deltaX: number, deltaY: number) => {
		setDragging(false);
		setOffset(0);
		const currentPullOffset = pullOffset();
		setPullOffset(0);
		const currentAxis = axis;
		axis = null;
		source = null;

		// Handle pull-to-refresh (compare scaled values)
		if (currentAxis === "y" && currentPullOffset >= pullThreshold * offsetScale && props.onRefresh) {
			props.onRefresh();
			return;
		}

		if (
			Math.abs(deltaX) < swipeThreshold ||
			Math.abs(deltaX) < Math.abs(deltaY)
		) {
			return;
		}

		const currentIndex = props.order.indexOf(props.value());
		const direction = deltaX > 0 ? -1 : 1;
		const nextTab = props.order[currentIndex + direction];
		if (nextTab) {
			props.onChange(nextTab);
		}
	};

	const handleTouchStart = (event: TouchEvent) => {
		if (source === "pointer") {
			return;
		}
		const target = event.target as HTMLElement | null;
		if (isSwipeBlockedTarget(target)) {
			return;
		}
		source = "touch";
		start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
		axis = null;
		setDragging(true);
	};

	const handleTouchMove = (event: TouchEvent) => {
		if (source !== "touch" || !start) {
			return;
		}
		updateOffset(
			event.touches[0].clientX - start.x,
			event.touches[0].clientY - start.y,
		);
	};

	const handleTouchEnd = (event: TouchEvent) => {
		if (source !== "touch" || !start) {
			return;
		}
		const deltaX = event.changedTouches[0].clientX - start.x;
		const deltaY = event.changedTouches[0].clientY - start.y;
		start = null;
		finishSwipe(deltaX, deltaY);
	};

	const handlePointerStart = (event: PointerEvent) => {
		if (event.pointerType === "mouse") {
			return;
		}
		if (source === "touch") {
			return;
		}
		const target = event.target as HTMLElement | null;
		if (isSwipeBlockedTarget(target)) {
			return;
		}
		source = "pointer";
		start = { x: event.clientX, y: event.clientY };
		axis = null;
		setDragging(true);
	};

	const handlePointerMove = (event: PointerEvent) => {
		if (event.pointerType === "mouse") {
			return;
		}
		if (source !== "pointer" || !start) {
			return;
		}
		updateOffset(event.clientX - start.x, event.clientY - start.y);
	};

	const handlePointerEnd = (event: PointerEvent) => {
		if (event.pointerType === "mouse") {
			return;
		}
		if (source !== "pointer" || !start) {
			return;
		}
		const deltaX = event.clientX - start.x;
		const deltaY = event.clientY - start.y;
		start = null;
		finishSwipe(deltaX, deltaY);
	};

	const pullActive = () => pullOffset() >= pullThreshold * offsetScale;

	return (
		<>
			<PullIndicator
				active={pullActive()}
				refreshing={props.refreshing?.() ?? false}
			/>
			<div
				class={`swipeable-tabs${dragging() ? " is-dragging" : ""}`}
				onTouchStart={handleTouchStart}
				onTouchMove={handleTouchMove}
				onTouchEnd={handleTouchEnd}
				onTouchCancel={handleTouchEnd}
				onPointerDown={handlePointerStart}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerEnd}
				onPointerCancel={handlePointerEnd}
				style={{ transform: `translateX(${offset()}px)` }}
			>
				{props.children}
			</div>
		</>
	);
}
