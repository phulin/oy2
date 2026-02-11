import type { App } from "../types";

export function registerMiscRoutes(app: App) {
	app.get("/.well-known/apple-app-site-association", (c) => {
		return c.json({
			webcredentials: {
				apps: [`${c.env.APPLE_TEAM_ID}.site.oyme`],
			},
		});
	});

	app.get("/.well-known/gpc.json", (c) => {
		return c.json({
			gpc: true,
			lastUpdate: "2026-01-16",
		});
	});
}
