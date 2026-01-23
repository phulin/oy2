import type { Accessor, JSX } from "solid-js";
import { createSignal, onCleanup, onMount } from "solid-js";
import { PullIndicator } from "./PullIndicator";
import "./SwipeableTabs.css";

type SwipeableTabsProps = {
	value: () => string;
	onChange: (next: string) => void;
	order: readonly string[];
	children: JSX.Element;
	onRefresh?: () => void;
	refreshing?: Accessor<boolean>;
	refreshableTabs?: readonly string[];
};

const PULL_MAX = 128;
const PULL_K = 0.4;
const SHOW_INDICATOR_THRESHOLD = 50;
const TRIGGER_THRESHOLD = 100;
const LOADING_OFFSET = 48;

function appr(x: number) {
	return PULL_MAX * (1 - Math.exp((-PULL_K * x) / PULL_MAX));
}

export function SwipeableTabs(props: SwipeableTabsProps) {
	const [offset, setOffset] = createSignal(0);
	const [dragging, setDragging] = createSignal(false);
	const [pullY, setPullY] = createSignal(0);
	const [pullTransition, setPullTransition] = createSignal(false);
	let start: { x: number; y: number } | null = null;
	let axis: "x" | "y" | "pull" | null = null;
	let frame: number | undefined;
	let latestDelta = { x: 0, y: 0 };

	const maxOffset = 84;
	const offsetScale = 0.4;
	const swipeThreshold = 45;

	const canRefresh = () =>
		props.onRefresh &&
		(!props.refreshableTabs || props.refreshableTabs.includes(props.value()));

	const isRefreshing = () => props.refreshing?.() === true;
	const showIndicator = () =>
		pullY() > SHOW_INDICATOR_THRESHOLD || isRefreshing();
	const indicatorFlipped = () => pullY() > TRIGGER_THRESHOLD;

	const currentPullOffset = () => {
		if (isRefreshing()) {
			return LOADING_OFFSET;
		}
		return appr(pullY());
	};

	const isSwipeBlockedTarget = (target: HTMLElement | null) =>
		!!target?.closest(".oys-location-map");

	const isAtTop = () => {
		const scrollEl = scrollRef;
		return scrollEl ? scrollEl.scrollTop <= 1 : true;
	};

	const updateOffset = (deltaX: number) => {
		const scaled = deltaX * offsetScale;
		const clamped = Math.max(-maxOffset, Math.min(maxOffset, scaled));
		setOffset(clamped);
	};

	const finishSwipe = (deltaX: number, deltaY: number) => {
		setDragging(false);
		setOffset(0);

		if (axis !== "x") {
			axis = null;
			return;
		}

		axis = null;

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

	const beginDrag = (
		clientX: number,
		clientY: number,
		target: HTMLElement | null,
		currentTarget: HTMLElement | null,
		pointerId?: number,
	) => {
		if (isSwipeBlockedTarget(target)) {
			return;
		}
		start = { x: clientX, y: clientY };
		axis = null;
		setDragging(true);
		if (pointerId !== undefined) {
			currentTarget?.setPointerCapture(pointerId);
		}
	};

	const scheduleUpdate = () => {
		if (frame) {
			return;
		}
		frame = window.requestAnimationFrame(() => {
			frame = undefined;
			if (axis === "x") {
				updateOffset(latestDelta.x);
			}
		});
	};

	const handleMove = (
		deltaX: number,
		deltaY: number,
		event: { preventDefault: () => void },
	) => {
		// Determine axis on first significant movement
		if (!axis) {
			const dominated = Math.abs(deltaX) > Math.abs(deltaY);
			if (dominated) {
				axis = "x";
			} else if (deltaY > 0 && isAtTop() && canRefresh() && !isRefreshing()) {
				// Pulling down while at top - enter pull mode
				axis = "pull";
			} else {
				axis = "y";
			}
		}

		if (axis === "pull") {
			// In pull mode, update pull distance and prevent scroll
			event.preventDefault();
			if (deltaY > 0) {
				setPullY(deltaY);
			} else {
				// User pushed back up, exit pull mode
				setPullY(0);
				axis = "y";
			}
		} else if (axis === "x") {
			event.preventDefault();
			latestDelta = { x: deltaX, y: deltaY };
			scheduleUpdate();
		}
	};

	const finishPull = (deltaY: number) => {
		const shouldTrigger =
			deltaY > TRIGGER_THRESHOLD && canRefresh() && !isRefreshing();

		setPullTransition(true);
		setPullY(0);

		if (shouldTrigger && props.onRefresh) {
			props.onRefresh();
		}
	};

	const handleTransitionEnd = () => {
		setPullTransition(false);
	};

	const handlePointerStart = (event: PointerEvent) => {
		if (
			!event.isPrimary ||
			(event.pointerType !== "touch" && event.pointerType !== "pen")
		) {
			return;
		}
		beginDrag(
			event.clientX,
			event.clientY,
			event.target as HTMLElement | null,
			event.currentTarget as HTMLElement | null,
			event.pointerId,
		);
	};

	const handlePointerMove = (event: PointerEvent) => {
		if (!start) {
			return;
		}
		const deltaX = event.clientX - start.x;
		const deltaY = event.clientY - start.y;
		handleMove(deltaX, deltaY, event);
	};

	const handlePointerEnd = (event: PointerEvent) => {
		if (!start) {
			return;
		}
		const deltaX = event.clientX - start.x;
		const deltaY = event.clientY - start.y;
		start = null;

		if (axis === "pull") {
			finishPull(deltaY);
		}

		finishSwipe(deltaX, deltaY);
	};

	const handleTouchStart = (event: TouchEvent) => {
		const touch = event.touches[0];
		if (!touch) {
			return;
		}
		beginDrag(
			touch.clientX,
			touch.clientY,
			event.target as HTMLElement | null,
			event.currentTarget as HTMLElement | null,
		);
	};

	const handleTouchMove = (event: TouchEvent) => {
		if (!start) {
			return;
		}
		const touch = event.touches[0];
		if (!touch) {
			return;
		}
		const deltaX = touch.clientX - start.x;
		const deltaY = touch.clientY - start.y;
		handleMove(deltaX, deltaY, event);
	};

	const handleTouchEnd = (event: TouchEvent) => {
		if (!start) {
			return;
		}
		const touch = event.changedTouches[0];
		if (!touch) {
			return;
		}
		const deltaX = touch.clientX - start.x;
		const deltaY = touch.clientY - start.y;
		start = null;

		if (axis === "pull") {
			finishPull(deltaY);
		}

		finishSwipe(deltaX, deltaY);
	};

	let containerRef: HTMLDivElement | undefined;
	let scrollRef: HTMLDivElement | undefined;

	onMount(() => {
		const node = scrollRef;
		if (!node) {
			return;
		}
		const prefersTouch = "ontouchstart" in window;
		const supportsPointer = !prefersTouch && "PointerEvent" in window;
		if (supportsPointer) {
			node.addEventListener("pointerdown", handlePointerStart, {
				passive: true,
			});
			node.addEventListener("pointermove", handlePointerMove, {
				passive: false,
			});
			node.addEventListener("pointerup", handlePointerEnd, { passive: true });
			node.addEventListener("pointercancel", handlePointerEnd, {
				passive: true,
			});
		} else {
			node.addEventListener("touchstart", handleTouchStart, {
				passive: true,
			});
			node.addEventListener("touchmove", handleTouchMove, { passive: false });
			node.addEventListener("touchend", handleTouchEnd, { passive: true });
			node.addEventListener("touchcancel", handleTouchEnd, {
				passive: true,
			});
		}

		onCleanup(() => {
			if (supportsPointer) {
				node.removeEventListener("pointerdown", handlePointerStart);
				node.removeEventListener("pointermove", handlePointerMove);
				node.removeEventListener("pointerup", handlePointerEnd);
				node.removeEventListener("pointercancel", handlePointerEnd);
			} else {
				node.removeEventListener("touchstart", handleTouchStart);
				node.removeEventListener("touchmove", handleTouchMove);
				node.removeEventListener("touchend", handleTouchEnd);
				node.removeEventListener("touchcancel", handleTouchEnd);
			}
		});
	});

	onCleanup(() => {
		if (frame) {
			window.cancelAnimationFrame(frame);
		}
	});

	return (
		<div class="swipeable-tabs-wrapper">
			<PullIndicator
				visible={showIndicator}
				flipped={indicatorFlipped}
				loading={isRefreshing}
			/>
			<div
				ref={containerRef}
				class={`swipeable-tabs${dragging() ? " is-dragging" : ""}${pullTransition() ? " is-pull-transitioning" : ""}`}
				style={{
					transform: `translateX(${offset()}px) translateY(${currentPullOffset()}px)`,
				}}
				onTransitionEnd={handleTransitionEnd}
			>
				<div ref={scrollRef} class="swipeable-tabs-scroll">
					{props.children}
				</div>
			</div>
		</div>
	);
}
