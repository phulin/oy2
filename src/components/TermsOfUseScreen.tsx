import { createResource } from "solid-js";
import { AppHeader } from "./AppHeader";
import { Screen } from "./Screen";
import "./TermsOfUseScreen.css";

async function loadTermsOfUse() {
	const response = await fetch("/terms.txt");
	return response.text();
}

export function TermsOfUseScreen() {
	const [terms] = createResource(loadTermsOfUse);

	return (
		<Screen>
			<AppHeader backHref="/" />
			<pre class="terms-content">{terms()}</pre>
		</Screen>
	);
}
