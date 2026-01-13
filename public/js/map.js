const LIGHT_TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const DARK_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors &copy; CARTO';

function prefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function initLocationMap(container, lat, lon) {
  if (!window.L) {
    throw new Error('Leaflet not loaded');
  }

  if (container.dataset.mapInit === 'true') {
    return;
  }

  const map = window.L.map(container, {
    center: [lat, lon],
    zoom: 15,
    zoomControl: false,
    attributionControl: false,
  });

  const tileLayer = window.L.tileLayer(
    prefersDark() ? DARK_TILE_URL : LIGHT_TILE_URL,
    { attribution: TILE_ATTRIBUTION }
  );
  tileLayer.addTo(map);
  window.L.marker([lat, lon]).addTo(map);
  window.L.control.attribution({ prefix: false }).addTo(map);

  container.dataset.mapInit = 'true';
  container.dataset.mapLat = String(lat);
  container.dataset.mapLon = String(lon);
  container._leafletMap = map;
  container._leafletTileLayer = tileLayer;

  if (window.matchMedia) {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTiles = () => {
      const url = prefersDark() ? DARK_TILE_URL : LIGHT_TILE_URL;
      container._leafletTileLayer.setUrl(url);
    };
    if (media.addEventListener) {
      media.addEventListener('change', updateTiles);
    } else if (media.addListener) {
      media.addListener(updateTiles);
    }
  }
}
