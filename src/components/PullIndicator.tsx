import type { Accessor } from "solid-js";
import { Show } from "solid-js";
import "./PullIndicator.css";

type PullIndicatorProps = {
	visible: Accessor<boolean>;
	flipped: Accessor<boolean>;
	loading: Accessor<boolean>;
};

export function PullIndicator(props: PullIndicatorProps) {
	return (
		<Show when={props.visible()}>
			<div
				class={`pull-indicator${props.flipped() ? " flip" : ""}${props.loading() ? " loading" : ""}`}
			>
				<Show when={props.loading()} fallback={<span class="arrow">↓</span>}>
					<span class="spinner" />
				</Show>
			</div>
		</Show>
	);
}
