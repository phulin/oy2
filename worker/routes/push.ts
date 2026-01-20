import { invalidatePushSubscriptionsCache } from "../lib";
import type { App, AppContext } from "../types";

export function registerPushRoutes(app: App) {
	app.post("/api/push/subscribe", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const { endpoint, keys } = await c.req.json();

		if (!endpoint || !keys?.p256dh || !keys?.auth) {
			return c.json({ error: "Invalid subscription" }, 400);
		}

		await c
			.get("db")
			.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);

		await c.get("db").query(
			`
      INSERT INTO push_subscriptions
        (user_id, endpoint, keys_p256dh, keys_auth)
      VALUES ($1, $2, $3, $4)
    `,
			[user.id, endpoint, keys.p256dh, keys.auth],
		);
		await invalidatePushSubscriptionsCache(c, user.id);

		return c.json({ success: true });
	});

	app.post("/api/push/unsubscribe", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const { endpoint } = await c.req.json();

		if (!endpoint) {
			return c.json({ error: "Missing endpoint" }, 400);
		}

		await c
			.get("db")
			.query(
				"DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2",
				[user.id, endpoint],
			);
		await invalidatePushSubscriptionsCache(c, user.id);

		return c.json({ success: true });
	});

	app.get("/api/push/vapid-public-key", async (c: AppContext) => {
		return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
	});
}
