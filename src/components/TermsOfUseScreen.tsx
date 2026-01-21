import { createResource } from "solid-js";
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
				<a class="terms-home" href="/">
					Oy
				</a>
				<span class="terms-title">Terms of Use</span>
			</header>
			<pre class="terms-content">{terms()}</pre>
		</div>
	);
}
