import { invalidatePushSubscriptionsCache } from "../lib";
import type { App } from "../types";

export function registerPushRoutes(app: App) {
	app.post("/api/push/subscribe", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const { endpoint, keys } = await c.req.json();

		if (!endpoint || !keys?.p256dh || !keys?.auth) {
			return c.json({ error: "Invalid subscription" }, 400);
		}

		await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
			.bind(endpoint)
			.run();

		await c.env.DB.prepare(
			`
      INSERT OR REPLACE INTO push_subscriptions
        (user_id, endpoint, keys_p256dh, keys_auth)
      VALUES (?, ?, ?, ?)
    `,
		)
			.bind(user.id, endpoint, keys.p256dh, keys.auth)
			.run();
		await invalidatePushSubscriptionsCache(c.env, user.id);

		return c.json({ success: true });
	});

	app.post("/api/push/unsubscribe", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const { endpoint } = await c.req.json();

		if (!endpoint) {
			return c.json({ error: "Missing endpoint" }, 400);
		}

		await c.env.DB.prepare(
			"DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
		)
			.bind(user.id, endpoint)
			.run();
		await invalidatePushSubscriptionsCache(c.env, user.id);

		return c.json({ success: true });
	});

	app.get("/api/push/vapid-public-key", async (c) => {
		return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
	});
}
