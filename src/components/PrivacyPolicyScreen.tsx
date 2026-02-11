import { A } from "@solidjs/router";
import { createResource } from "solid-js";
import { appLogoText } from "../branding";
import "./PrivacyPolicyScreen.css";

async function loadPrivacyPolicy() {
	const response = await fetch("/privacy.txt");
	return response.text();
}

export function PrivacyPolicyScreen() {
	const [policy] = createResource(loadPrivacyPolicy);

	return (
		<div class="privacy-screen">
			<header class="privacy-header">
				<A class="privacy-back" href="/">
					&lt; Back
				</A>
				<span class="privacy-logo">{appLogoText}</span>
				<span class="privacy-spacer" aria-hidden="true" />
			</header>
			<pre class="privacy-content">{policy()}</pre>
		</div>
	);
}
