import { A } from "@solidjs/router";
import { appLogoText } from "../branding";
import { Screen } from "../components/Screen";
import "../components/ButtonStyles.css";
import "./PublicHomeRoute.css";

export function PublicHomeRoute() {
	return (
		<Screen>
			<div class="public-home">
				<header class="public-home-hero">
					<h1 class="public-home-logo">{appLogoText}</h1>
					<h1 class="public-home-title">
						A tiny check-in that keeps friendships warm.
					</h1>
					<p class="public-home-subtitle">
						Send a fast "oy" to your close friends, keep lightweight streaks,
						and stay in sync without the noise of a traditional feed.
					</p>
					<div class="public-home-actions">
						<A class="btn-primary public-home-primary" href="/">
							Open the app
						</A>
						<A class="public-home-secondary" href="/terms">
							Read terms
						</A>
					</div>
				</header>

				<section class="public-home-features">
					<div class="public-home-card">
						<h2>Instant "oy" check-ins</h2>
						<p>
							Send a one-tap hello that lands with a push and keeps it simple.
						</p>
					</div>
					<div class="public-home-card">
						<h2>Streaks that feel gentle</h2>
						<p>
							Track the rhythm of your friendships without pressure or
							performative posting.
						</p>
					</div>
					<div class="public-home-card">
						<h2>Location when it matters</h2>
						<p>Attach a quick spot to an oy so friends can meet you fast.</p>
					</div>
					<div class="public-home-card">
						<h2>Secure sign-in options</h2>
						<p>
							Log in with passkeys, email, or Google, then add friends
							instantly.
						</p>
					</div>
				</section>

				<section class="public-home-cta">
					<h2>Ready to send your first oy?</h2>
					<p>Create your account or jump back into the app.</p>
					<A class="btn-primary public-home-primary" href="/">
						Go to Oy
					</A>
				</section>

				<footer class="public-home-legal">
					<A class="public-home-legal-link" href="/terms">
						Terms
					</A>
					<span class="public-home-legal-separator">·</span>
					<A class="public-home-legal-link" href="/privacy">
						Privacy
					</A>
					<span class="public-home-legal-separator">·</span>
					<A class="public-home-legal-link" href="/cookies">
						Cookies
					</A>
					<span class="public-home-legal-separator">·</span>
					<A class="public-home-legal-link" href="/legal">
						Other
					</A>
				</footer>
			</div>
		</Screen>
	);
}
