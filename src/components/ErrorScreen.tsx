import { A } from "@solidjs/router";
import { Screen } from "./Screen";
import "./ErrorScreen.css";

export function ErrorScreen() {
	return (
		<Screen>
			<div class="error-screen">
				<span class="error-code">404</span>
				<h2 class="error-title">Page not found</h2>
				<p class="error-description">
					Oy! That page doesn't exist. Check the link or head back home.
				</p>
				<A class="error-action" href="/">
					Go Oy some more
				</A>
			</div>
		</Screen>
	);
}
