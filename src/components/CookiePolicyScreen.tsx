import { A } from "@solidjs/router";
import { createResource } from "solid-js";
import { appLogoText } from "../branding";
import "./CookiePolicyScreen.css";

async function loadCookiePolicy() {
	const response = await fetch("/cookies.txt");
	return response.text();
}

export function CookiePolicyScreen() {
	const [policy] = createResource(loadCookiePolicy);

	return (
		<div class="cookies-screen">
			<header class="cookies-header">
				<A class="cookies-back" href="/">
					&lt; Back
				</A>
				<span class="cookies-logo">{appLogoText}</span>
				<span class="cookies-spacer" aria-hidden="true" />
			</header>
			<pre class="cookies-content">{policy()}</pre>
		</div>
	);
}
