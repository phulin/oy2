import { A } from "@solidjs/router";
import { createResource } from "solid-js";
import { appLogoText } from "../branding";
import "./TermsOfUseScreen.css";

async function loadTermsOfUse() {
	const response = await fetch("/terms.txt");
	return response.text();
}

export function TermsOfUseScreen() {
	const [terms] = createResource(loadTermsOfUse);

	return (
		<div class="terms-screen">
			<header class="terms-header">
				<A class="terms-back" href="/">
					&lt; Back
				</A>
				<span class="terms-logo">{appLogoText}</span>
				<span class="terms-spacer" aria-hidden="true" />
			</header>
			<pre class="terms-content">{terms()}</pre>
		</div>
	);
}
