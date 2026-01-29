export function urlBase64ToUint8Array(base64String: string) {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}

export function formatTime(timestamp: number) {
	const now = Math.floor(Date.now() / 1000);
	const diff = now - timestamp;

	if (diff < 60) return "Just now";
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}

export function onAppVisible(callback: () => void) {
	const handleVisibility = () => {
		if (document.visibilityState === "visible") {
			callback();
		}
	};

	document.addEventListener("visibilitychange", handleVisibility);
	window.addEventListener("focus", handleVisibility);

	return () => {
		document.removeEventListener("visibilitychange", handleVisibility);
		window.removeEventListener("focus", handleVisibility);
	};
}

export function calculateDistance(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number,
): string {
	const R = 6371; // Radius of the earth in km
	const dLat = deg2rad(lat2 - lat1);
	const dLon = deg2rad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(deg2rad(lat1)) *
			Math.cos(deg2rad(lat2)) *
			Math.sin(dLon / 2) *
			Math.sin(dLon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	const d = R * c; // Distance in km

	if (d < 1) {
		return `${Math.round(d * 1000)}m`;
	}
	return `${d.toFixed(1)}km`;
}

function deg2rad(deg: number) {
	return deg * (Math.PI / 180);
}
