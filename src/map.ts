import L from "leaflet";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";

const CARTO_API_KEY = import.meta.env.VITE_CARTO_API_KEY as string | undefined;

function cartoTileUrl(base: string): string {
	return CARTO_API_KEY
		? `${base}?key=${encodeURIComponent(CARTO_API_KEY)}`
		: base;
}

const LIGHT_TILE_URL = cartoTileUrl(
	"https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
);
const DARK_TILE_URL = cartoTileUrl(
	"https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
);
const TILE_ATTRIBUTION = "&copy; OpenStreetMap contributors &copy; CARTO";

L.Icon.Default.mergeOptions({
	iconUrl: markerIconUrl,
	iconRetinaUrl: markerIcon2xUrl,
	shadowUrl: markerShadowUrl,
});
L.Icon.Default.imagePath = "";

type MapContainer = HTMLDivElement & {
	_leafletMap?: L.Map;
	_leafletTileLayer?: L.TileLayer;
	_historyAdded?: boolean;
};

export type LoHistoryPoint = {
	lat: number;
	lon: number;
	intensity: number;
};

function prefersDark() {
	return window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

// Read a CSS variable from the document root, with a fallback hex value.
// This keeps colors in sync with styles.css rather than duplicating hex literals.
function getCssVar(name: string, fallback: string): string {
	return (
		getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
		fallback
	);
}

// Linearly interpolate between two integers (for RGB channels).
function lerp(a: number, b: number, t: number): number {
	return Math.round(a + (b - a) * t);
}

// Linearly interpolate between two floats (for opacity, weight, etc).
function lerpf(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

// Parse a 6-digit hex color into [r, g, b].
function parseHex(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.replace("#", ""), 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// Interpolate between two hex colors. t=0 → colorA, t=1 → colorB.
function interpolateColor(colorA: string, colorB: string, t: number): string {
	const [ar, ag, ab] = parseHex(colorA);
	const [br, bg, bb] = parseHex(colorB);
	const r = lerp(ar, br, t);
	const g = lerp(ag, bg, t);
	const b = lerp(ab, bb, t);
	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function initLocationMap(
	container: MapContainer,
	lat: number,
	lon: number,
	history?: LoHistoryPoint[],
) {
	if (container.dataset.mapInit === "true") {
		if (history && container._leafletMap && !container._historyAdded) {
			addHistoryMarkers(container._leafletMap, history);
			container._historyAdded = true;
		}
		return;
	}

	const map = L.map(container, {
		center: [lat, lon],
		zoom: 15,
		zoomControl: false,
		attributionControl: false,
	});

	const tileLayer = L.tileLayer(
		prefersDark() ? DARK_TILE_URL : LIGHT_TILE_URL,
		{
			attribution: TILE_ATTRIBUTION,
		},
	);
	tileLayer.addTo(map);

	if (history && history.length > 0) {
		addHistoryMarkers(map, history);
		container._historyAdded = true;
	}

	L.marker([lat, lon]).addTo(map);
	L.control.attribution({ prefix: false }).addTo(map);

	container.dataset.mapInit = "true";
	container._leafletMap = map;
	container._leafletTileLayer = tileLayer;

	const media = window.matchMedia("(prefers-color-scheme: dark)");
	const updateTiles = () => {
		const url = prefersDark() ? DARK_TILE_URL : LIGHT_TILE_URL;
		container._leafletTileLayer?.setUrl(url);
	};
	media.addEventListener("change", updateTiles);
}

// Render past lo locations as colored circle markers.
// intensity=0 (oldest) → --primary (purple), intensity=1 (newest) → --accent (amber).
// Older points are smaller, more transparent, and thinner.
function addHistoryMarkers(map: L.Map, history: LoHistoryPoint[]) {
	const primary = getCssVar("--primary", "#7c3aed");
	const accent = getCssVar("--accent", "#f59e0b");

	for (const point of history) {
		// Cubic curve compresses old points toward purple, spreading recent ones across the color range.
		const t = point.intensity ** 3;
		const color = interpolateColor(primary, accent, t);
		L.circleMarker([point.lat, point.lon], {
			radius: lerp(3, 7, t),
			color,
			fillColor: color,
			fillOpacity: lerpf(prefersDark() ? 0.45 : 0.2, 0.85, t),
			opacity: lerpf(prefersDark() ? 0.45 : 0.3, 1, t),
			weight: lerpf(0.5, 2, t),
		}).addTo(map);
	}
}
