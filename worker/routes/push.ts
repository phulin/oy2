import type { App, AppContext } from "../types";

const NATIVE_PUSH_PLATFORMS = new Set(["ios", "android"]);

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

		// Remove this endpoint from any other user (endpoint is device-specific)
		await c
			.get("db")
			.query(
				"DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id != $2",
				[endpoint, user.id],
			);

		await c.get("db").query(
			`
      DELETE FROM push_subscriptions
      WHERE user_id = $1 AND endpoint = $2 AND platform = 'web'
    `,
			[user.id, endpoint],
		);

		await c.get("db").query(
			`
      INSERT INTO push_subscriptions
        (user_id, platform, endpoint, keys_p256dh, keys_auth, native_token)
      VALUES ($1, 'web', $2, $3, $4, NULL)
    `,
			[user.id, endpoint, keys.p256dh, keys.auth],
		);

		return c.json({ success: true });
	});

	app.post("/api/push/native/subscribe", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const { token, platform } = await c.req.json();
		const nativeToken = typeof token === "string" ? token.trim() : "";
		const nativePlatform =
			typeof platform === "string" ? platform.trim().toLowerCase() : "";

		console.log("SUBSCRIBE", platform, token);

		if (!nativeToken || !NATIVE_PUSH_PLATFORMS.has(nativePlatform)) {
			return c.json({ error: "Invalid native subscription" }, 400);
		}

		await c
			.get("db")
			.query(
				"DELETE FROM push_subscriptions WHERE native_token = $1 AND user_id != $2",
				[nativeToken, user.id],
			);

		await c.get("db").query(
			`
      DELETE FROM push_subscriptions
      WHERE user_id = $1 AND native_token = $2
    `,
			[user.id, nativeToken],
		);

		await c.get("db").query(
			`
      INSERT INTO push_subscriptions
        (user_id, platform, endpoint, keys_p256dh, keys_auth, native_token)
      VALUES ($1, $2, NULL, NULL, NULL, $3)
    `,
			[user.id, nativePlatform, nativeToken],
		);

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
				"DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2 AND platform = 'web'",
				[user.id, endpoint],
			);

		return c.json({ success: true });
	});

	app.post("/api/push/native/unsubscribe", async (c: AppContext) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		const { token } = await c.req.json();
		const nativeToken = typeof token === "string" ? token.trim() : "";
		if (!nativeToken) {
			return c.json({ error: "Missing token" }, 400);
		}

		await c
			.get("db")
			.query(
				"DELETE FROM push_subscriptions WHERE user_id = $1 AND native_token = $2",
				[user.id, nativeToken],
			);

		return c.json({ success: true });
	});

	app.get("/api/push/vapid-public-key", async (c: AppContext) => {
		return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
	});
}
