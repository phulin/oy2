import { onCleanup, onMount } from "solid-js";
import { AppHeader } from "../components/AppHeader";
import { LegalScreen } from "../components/LegalScreen";
import { Screen } from "../components/Screen";

export function LegalRoute() {
	onMount(() => {
		const previousTitle = document.title;
		document.title = "Legal - Oy";
		onCleanup(() => {
			document.title = previousTitle;
		});
	});

	return (
		<Screen>
			<AppHeader backHref="/" />
			<LegalScreen />
		</Screen>
	);
}
