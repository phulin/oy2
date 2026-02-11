import { A } from "@solidjs/router";
import { onCleanup, onMount } from "solid-js";
import { appLogoText } from "../branding";
import { LegalScreen } from "../components/LegalScreen";
import { Screen } from "../components/Screen";
import "./LegalRoute.css";

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
			<header class="legal-route-header">
				<A class="legal-route-back" href="/">
					&lt; Back
				</A>
				<span class="legal-route-logo">{appLogoText}</span>
				<span class="legal-route-spacer" aria-hidden="true" />
			</header>
			<LegalScreen />
		</Screen>
	);
}
