import { Button } from "@kobalte/core/button";
import { createSignal } from "solid-js";
import "./ButtonStyles.css";
import "./DsarRequestScreen.css";
import "./FormControls.css";

type DsarRequestScreenProps = {
	api: <T>(path: string, options?: RequestInit) => Promise<T>;
};

type DsarRequestType =
	| "access"
	| "delete"
	| "correct"
	| "portability"
	| "object"
	| "restrict";

const requestTypeOptions: { value: DsarRequestType; label: string }[] = [
	{ value: "access", label: "Access my data" },
	{ value: "delete", label: "Delete my data" },
	{ value: "correct", label: "Correct my data" },
	{ value: "portability", label: "Data portability" },
	{ value: "object", label: "Object to processing" },
	{ value: "restrict", label: "Restrict processing" },
];

export function DsarRequestScreen(props: DsarRequestScreenProps) {
	const [requestType, setRequestType] = createSignal<DsarRequestType>("access");
	const [jurisdiction, setJurisdiction] = createSignal("");
	const [details, setDetails] = createSignal("");
	const [error, setError] = createSignal<string | null>(null);
	const [message, setMessage] = createSignal<string | null>(null);
	const [submitting, setSubmitting] = createSignal(false);

	async function submitRequest() {
		setError(null);
		setMessage(null);
		setSubmitting(true);

		try {
			await props.api<{ success: boolean }>("/api/dsar", {
				method: "POST",
				body: JSON.stringify({
					requestType: requestType(),
					jurisdiction: jurisdiction().trim(),
					details: details().trim(),
				}),
			});
			setMessage("Request submitted. We will reply from contact@oyme.site.");
			setDetails("");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div class="dsar-screen">
			<section class="dsar-section">
				<h3 class="dsar-title">Data Rights Request (DSAR)</h3>
				<p class="dsar-description">
					Submit a privacy request from your logged-in account so we can verify
					identity and process it faster.
				</p>

				<label class="dsar-label" for="dsar-request-type">
					Request type
				</label>
				<select
					id="dsar-request-type"
					class="app-text-input dsar-select"
					value={requestType()}
					onInput={(event) =>
						setRequestType(event.currentTarget.value as DsarRequestType)
					}
				>
					{requestTypeOptions.map((option) => (
						<option value={option.value}>{option.label}</option>
					))}
				</select>

				<label class="dsar-label" for="dsar-jurisdiction">
					Jurisdiction
				</label>
				<input
					id="dsar-jurisdiction"
					class="app-text-input"
					type="text"
					placeholder="Example: US-CA, US-NY, UK, EU-DE"
					value={jurisdiction()}
					onInput={(event) => setJurisdiction(event.currentTarget.value)}
				/>

				<label class="dsar-label" for="dsar-details">
					Request details
				</label>
				<textarea
					id="dsar-details"
					class="app-text-input dsar-textarea"
					placeholder="Describe what you need and include any relevant dates or context."
					value={details()}
					onInput={(event) => setDetails(event.currentTarget.value)}
				/>

				{error() && <p class="form-error">{error()}</p>}
				{message() && <p class="dsar-message">{message()}</p>}

				<div class="dsar-actions">
					<Button
						class="btn-primary"
						onClick={submitRequest}
						disabled={submitting()}
					>
						{submitting() ? "Submitting..." : "Submit DSAR request"}
					</Button>
				</div>
			</section>
		</div>
	);
}
