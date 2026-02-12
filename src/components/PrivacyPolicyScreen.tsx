import { createResource } from "solid-js";
import { AppHeader } from "./AppHeader";
import { Screen } from "./Screen";
import "./PrivacyPolicyScreen.css";

async function loadPrivacyPolicy() {
	const response = await fetch("/privacy.txt");
	return response.text();
}

export function PrivacyPolicyScreen() {
	const [policy] = createResource(loadPrivacyPolicy);

	return (
		<Screen>
			<AppHeader backHref="/" />
			<pre class="privacy-content">{policy()}</pre>
		</Screen>
	);
}
