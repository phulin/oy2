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
});
