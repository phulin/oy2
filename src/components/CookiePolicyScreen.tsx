import { createResource } from "solid-js";
import { AppHeader } from "./AppHeader";
import { Screen } from "./Screen";
import "./CookiePolicyScreen.css";

async function loadCookiePolicy() {
	const response = await fetch("/cookies.txt");
	return response.text();
}

export function CookiePolicyScreen() {
	const [policy] = createResource(loadCookiePolicy);

	return (
		<Screen>
			<AppHeader backHref="/" />
			<pre class="cookies-content">{policy()}</pre>
		</Screen>
	);
}
