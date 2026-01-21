import { Route, Router } from "@solidjs/router";
import { render } from "solid-js/web";
import App from "./App";
import { ErrorScreen } from "./components/ErrorScreen";
import { PrivacyPolicyScreen } from "./components/PrivacyPolicyScreen";
import { TermsOfUseScreen } from "./components/TermsOfUseScreen";
import { AdminRoute } from "./routes/AdminRoute";
import { AppHomeRoute } from "./routes/AppHomeRoute";
import { PasskeyAddRoute } from "./routes/PasskeyAddRoute";
import { SettingsRoute } from "./routes/SettingsRoute";
import "leaflet/dist/leaflet.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
	throw new Error("Root element not found");
}

render(
	() => (
		<Router>
			<Route path="/" component={App}>
				<Route path="" component={AppHomeRoute} />
				<Route path="settings" component={SettingsRoute} />
				<Route path="settings/passkeys/new" component={PasskeyAddRoute} />
				<Route path="admin" component={AdminRoute} />
			</Route>
			<Route path="/privacy" component={PrivacyPolicyScreen} />
			<Route path="/terms" component={TermsOfUseScreen} />
			<Route path="*" component={ErrorScreen} />
		</Router>
	),
	root,
);
