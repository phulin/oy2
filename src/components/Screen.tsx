import type { JSX } from "solid-js";
import "./Screen.css";

type ScreenProps = {
	children: JSX.Element;
};

export function Screen(props: ScreenProps) {
	return (
		<div class="app-screen">
			<div class="app-container">{props.children}</div>
		</div>
	);
}
