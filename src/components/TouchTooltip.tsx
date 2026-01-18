import { Tooltip } from "@kobalte/core/tooltip";
import type { JSX } from "solid-js";
import { createSignal } from "solid-js";

type TouchTooltipProps = {
	trigger: JSX.Element;
	content: JSX.Element;
	triggerClass?: string;
	contentClass?: string;
	openDelay?: number;
};

export function TouchTooltip(props: TouchTooltipProps) {
	const [open, setOpen] = createSignal(false);
	const [lock, setLock] = createSignal(false);

	return (
		<Tooltip
			open={open()}
			onOpenChange={(isOpen) => {
				if (lock()) {
					if (isOpen) {
						setOpen(true);
					}
					return;
				}
				setOpen(isOpen);
			}}
			openDelay={props.openDelay ?? 100}
		>
			<Tooltip.Trigger
				as="button"
				type="button"
				class={props.triggerClass}
				onPointerDown={(event) => {
					if (event.pointerType === "touch") {
						setLock(true);
						setOpen((wasOpen) => {
							const nextOpen = !wasOpen;
							if (!nextOpen) {
								setLock(false);
							}
							return nextOpen;
						});
					}
				}}
			>
				{props.trigger}
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content
					class={props.contentClass}
					onPointerDownOutside={(event) => {
						if (event.detail.originalEvent.pointerType === "touch") {
							setLock(false);
							setOpen(false);
						}
					}}
				>
					{props.content}
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip>
	);
}
