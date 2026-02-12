import { A } from "@solidjs/router";
import "./ButtonStyles.css";
import "./LegalScreen.css";

export function LegalScreen() {
	return (
		<div class="legal-screen">
			<section class="legal-section">
				<div class="legal-section-row">
					<div>
						<h3 class="legal-section-title">Terms of Use</h3>
						<p class="legal-section-description">
							Read the rules and conditions for using Oy.
						</p>
					</div>
					<A class="btn-secondary legal-link-button" href="/terms">
						View terms
					</A>
				</div>
			</section>

			<section class="legal-section">
				<div class="legal-section-row">
					<div>
						<h3 class="legal-section-title">Privacy Policy</h3>
						<p class="legal-section-description">
							See what data Oy collects and how it is used.
						</p>
					</div>
					<A class="btn-secondary legal-link-button" href="/privacy">
						View privacy policy
					</A>
				</div>
			</section>

			<section class="legal-section">
				<div class="legal-section-row">
					<div>
						<h3 class="legal-section-title">Cookie Policy</h3>
						<p class="legal-section-description">
							Review essential cookie and local storage usage in Oy.
						</p>
					</div>
					<A class="btn-secondary legal-link-button" href="/cookies">
						View cookie policy
					</A>
				</div>
			</section>

			<section class="legal-section">
				<div class="legal-section-row">
					<div>
						<h3 class="legal-section-title">Data Rights Request (DSAR)</h3>
						<p class="legal-section-description">
							Submit a logged-in DSAR request so we can verify the requester.
						</p>
					</div>
					<A class="btn-secondary legal-link-button" href="/settings/dsar">
						Open DSAR form
					</A>
				</div>
			</section>

			<section class="legal-section">
				<div class="legal-section-row">
					<div>
						<h3 class="legal-section-title">General Contact</h3>
						<p class="legal-section-description">
							For non-DSAR legal questions, email our support contact.
						</p>
					</div>
					<a
						class="btn-secondary legal-link-button"
						href="mailto:contact@oyme.site"
					>
						Email contact@oyme.site
					</a>
				</div>
			</section>
		</div>
	);
}
