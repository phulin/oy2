import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonRequest } from "./testHelpers";
import { createTestEnv, seedSession, seedUser } from "./testUtils";

describe("push subscriptions", () => {
	it("validates subscription payloads", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Pushy" });
		seedSession(db, user.id, "push-token");
		const { res, json } = await jsonRequest(env, "/api/push/subscribe", {
			method: "POST",
			headers: { "x-session-token": "push-token" },
			body: { endpoint: "https://example.com" },
		});
		assert.equal(res.status, 400);
		assert.equal(json.error, "Invalid subscription");
	});

	it("subscribes and unsubscribes endpoints", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Pushy" });
		seedSession(db, user.id, "push-token");
		const { res, json } = await jsonRequest(env, "/api/push/subscribe", {
			method: "POST",
			headers: { "x-session-token": "push-token" },
			body: {
				endpoint: "https://example.com",
				keys: { p256dh: "p256", auth: "auth" },
			},
		});
		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		assert.equal(db.pushSubscriptions.length, 1);

		const { res: unsubRes, json: unsubJson } = await jsonRequest(
			env,
			"/api/push/unsubscribe",
			{
				method: "POST",
				headers: { "x-session-token": "push-token" },
				body: { endpoint: "https://example.com" },
			},
		);
		assert.equal(unsubRes.status, 200);
		assert.equal(unsubJson.success, true);
		assert.equal(db.pushSubscriptions.length, 0);
	});
});
