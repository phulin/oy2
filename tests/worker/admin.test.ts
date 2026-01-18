import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonRequest } from "./testHelpers";
import {
	createTestEnv,
	seedNotificationDelivery,
	seedSession,
	seedUser,
} from "./testUtils";

describe("admin", () => {
	it("returns admin stats", async () => {
		const { env, db } = createTestEnv();
		const now = Math.floor(Date.now() / 1000);
		const admin = seedUser(db, {
			username: "Admin",
			admin: 1,
			lastSeen: now,
		});
		seedSession(db, admin.id, "admin-token");
		const user = seedUser(db, { username: "User", lastSeen: now });
		seedSession(db, user.id, "user-session");
		seedNotificationDelivery(db, {
			notificationId: 1,
			endpoint: "https://example.com",
			attempt: 1,
			success: 1,
		});
		const { res, json } = await jsonRequest(env, "/api/admin/stats", {
			headers: { "x-session-token": "admin-token" },
		});
		const body = json as {
			stats: { usersCount: number; subscriptionsCount: number };
			activeUsers: Array<unknown>;
		};
		assert.equal(res.status, 200);
		assert.equal(body.stats.usersCount, 2);
		assert.equal(body.stats.subscriptionsCount, 0);
		assert.equal(body.activeUsers.length, 2);
	});

	it("toggles phone auth for admins", async () => {
		const { env, db } = createTestEnv();
		const admin = seedUser(db, { username: "Admin", admin: 1 });
		seedSession(db, admin.id, "admin-token");
		const { res: getRes, json: getJson } = await jsonRequest(
			env,
			"/api/admin/phone-auth",
			{ headers: { "x-session-token": "admin-token" } },
		);
		const getBody = getJson as { enabled: boolean };
		assert.equal(getRes.status, 200);
		assert.equal(getBody.enabled, true);

		const { res: putRes, json: putJson } = await jsonRequest(
			env,
			"/api/admin/phone-auth",
			{
				method: "PUT",
				headers: { "x-session-token": "admin-token" },
				body: { enabled: false },
			},
		);
		const putBody = putJson as { enabled: boolean };
		assert.equal(putRes.status, 200);
		assert.equal(putBody.enabled, false);
	});
});
