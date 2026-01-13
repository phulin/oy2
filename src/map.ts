import L from "leaflet";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";

const LIGHT_TILE_URL =
	"https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const DARK_TILE_URL =
	"https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION = "&copy; OpenStreetMap contributors &copy; CARTO";

L.Icon.Default.mergeOptions({
	iconUrl: markerIconUrl,
	iconRetinaUrl: markerIcon2xUrl,
	shadowUrl: markerShadowUrl,
});

type MapContainer = HTMLDivElement & {
	_leafletMap?: L.Map;
	_leafletTileLayer?: L.TileLayer;
};

function prefersDark() {
	return window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

export function initLocationMap(
	container: MapContainer,
	lat: number,
	lon: number,
) {
	if (container.dataset.mapInit === "true") {
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
