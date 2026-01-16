import { createResource } from "solid-js";
import "./PrivacyPolicyScreen.css";

async function loadPrivacyPolicy() {
	const response = await fetch("/privacy.md");
	return response.text();
}

export function PrivacyPolicyScreen() {
	const [policy] = createResource(loadPrivacyPolicy);

	return (
		<div class="privacy-screen">
			<header class="privacy-header">
				<a class="privacy-home" href="/">
					Oy
				</a>
				<span class="privacy-title">Privacy Policy</span>
			</header>
			<pre class="privacy-content">{policy()}</pre>
		</div>
	);
}
