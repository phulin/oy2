/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope & {
	__WB_MANIFEST: Array<{ url: string; revision?: string }>;
};

precacheAndRoute(self.__WB_MANIFEST);
self.skipWaiting();
clientsClaim();

self.addEventListener("push", (event) => {
	let data: {
		title?: string;
		body?: string;
		icon?: string;
		badge?: string;
		tag?: string;
		url?: string;
	} = {
		title: "Oy!",
		body: "Someone sent you an Oy!",
	};

	if (event.data) {
		try {
			data = event.data.json();
		} catch {
			data.body = event.data.text();
		}
	}

	const options: NotificationOptions & { vibrate?: number[] } = {
		body: data.body,
		icon: data.icon || "/icon-192.png",
		badge: data.badge || "/icon-192.png",
		tag: data.tag || "yo-notification",
		vibrate: [200, 100, 200],
		requireInteraction: false,
		data: {
			url: data.url || "/",
		},
	};

	const notifyPromise = self.registration.showNotification(
		data.title ?? "Oy!",
		options,
	);
	const broadcastPromise = self.clients
		.matchAll({ type: "window", includeUncontrolled: true })
		.then((clientList) => {
			if (clientList.length === 0) {
				return;
			}
			for (const client of clientList) {
				client.postMessage({ type: "push", payload: data });
			}
		});

	event.waitUntil(Promise.all([notifyPromise, broadcastPromise]));
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();

	const targetUrl = event.notification?.data?.url || "/";

	event.waitUntil(
		self.clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then((clientList) => {
				for (const client of clientList) {
					if ("navigate" in client) {
						return client.navigate(targetUrl).then(() => client.focus());
					}
				}

				if (self.clients.openWindow) {
					return self.clients.openWindow(targetUrl);
				}
			}),
	);
});
