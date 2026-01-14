import { Button } from "@kobalte/core/button";
import type { ComponentProps } from "solid-js";
import { createSignal, Show, splitProps } from "solid-js";
import "./AsyncButton.css";

type AsyncButtonProps = {
	onClick: () => Promise<void>;
	disabled?: boolean;
} & Omit<ComponentProps<typeof Button>, "onClick" | "disabled">;

export function AsyncButton(props: AsyncButtonProps) {
	const [local, others] = splitProps(props, [
		"onClick",
		"disabled",
		"class",
		"children",
		"onPointerUp",
		"onTouchEnd",
		"onTouchCancel",
	]);
	const [loading, setLoading] = createSignal(false);

	const handleClick = async (_event: MouseEvent) => {
		setLoading(true);
		try {
			await local.onClick();
		} finally {
			setLoading(false);
		}
	};

	const handlePointerUp = (event: PointerEvent) => {
		(event.currentTarget as HTMLButtonElement).blur();
		local.onPointerUp?.(event);
	};

	const handleTouchEnd = (event: TouchEvent) => {
		(event.currentTarget as HTMLButtonElement).blur();
		local.onTouchEnd?.(event);
	};

	const handleTouchCancel = (event: TouchEvent) => {
		(event.currentTarget as HTMLButtonElement).blur();
		local.onTouchCancel?.(event);
	};

	const className = () =>
		[local.class, "async-button"].filter(Boolean).join(" ");

	return (
		<Button
			{...others}
			class={className()}
			onClick={handleClick}
			onPointerUp={handlePointerUp}
			onTouchEnd={handleTouchEnd}
			onTouchCancel={handleTouchCancel}
			disabled={local.disabled || loading()}
			aria-busy={loading()}
		>
			<span
				class="async-button-label"
				aria-hidden={loading() ? "true" : undefined}
			>
				{local.children}
			</span>
			<Show when={loading()}>
				<span class="async-button-spinner" aria-hidden="true" />
			</Show>
		</Button>
	);
}
