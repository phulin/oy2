import { render } from "solid-js/web";
import App from "./App";
import "leaflet/dist/leaflet.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
	throw new Error("Root element not found");
}

render(() => <App />, root);
