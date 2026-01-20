import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonRequest } from "./testHelpers";
import {
	createTestEnv,
	getStreakDateBoundaries,
	seedFriendship,
	seedLastOyInfo,
	seedSession,
	seedUser,
	seedOy,
} from "./testUtils";

describe("oys and los", () => {
	it("prevents sending to non-friends", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Sender" });
		const target = seedUser(db, { username: "Target" });
		seedSession(db, user.id, "send-token");
		const { res, json } = await jsonRequest(env, "/api/oy", {
			method: "POST",
			headers: { "x-session-token": "send-token" },
			body: { toUserId: target.id },
		});
		assert.equal(res.status, 403);
		assert.equal(json.error, "You can only send Oys to friends");
	});

	it("creates oy, notifications, and last oy info updates", async () => {
		const { env, db } = createTestEnv();
		const sender = seedUser(db, { username: "Sender" });
		const receiver = seedUser(db, { username: "Receiver" });
		seedSession(db, sender.id, "oy-token");
		seedFriendship(db, sender.id, receiver.id);
		seedFriendship(db, receiver.id, sender.id);
		const { res, json } = await jsonRequest(env, "/api/oy", {
			method: "POST",
			headers: { "x-session-token": "oy-token" },
			body: { toUserId: receiver.id },
		});
		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		assert.equal(db.oys.length, 1);
		assert.equal(db.notifications.length, 1);
		assert.equal(db.lastOyInfo.length, 2);
		const lastOyInfo = db.lastOyInfo.find(
			(row) => row.user_id === sender.id && row.friend_id === receiver.id,
		);
		assert.equal(lastOyInfo?.last_oy_type, "oy");
	});

	it("increments streak when sending oy day after last oy", async () => {
		const { env, db } = createTestEnv();
		const sender = seedUser(db, { username: "Sender" });
		const receiver = seedUser(db, { username: "Receiver" });
		seedSession(db, sender.id, "streak-inc-token");
		const { startOfTodayNY, startOfYesterdayNY } = getStreakDateBoundaries();
		const streakStartDate = startOfYesterdayNY - 2 * 24 * 60 * 60;
		const lastOyCreatedAt = startOfYesterdayNY + 60;
		seedFriendship(db, sender.id, receiver.id);
		seedFriendship(db, receiver.id, sender.id);
		seedLastOyInfo(db, {
			userId: sender.id,
			friendId: receiver.id,
			lastOyCreatedAt,
			streakStartDate,
		});
		const { res, json } = await jsonRequest(env, "/api/oy", {
			method: "POST",
			headers: { "x-session-token": "streak-inc-token" },
			body: { toUserId: receiver.id },
		});
		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		const lastOyInfo = db.lastOyInfo.find(
			(row) => row.user_id === sender.id && row.friend_id === receiver.id,
		);
		assert.equal(json.streak, 4);
		assert.equal(lastOyInfo?.streak_start_date, streakStartDate);
	});

	it("keeps streak same when sending oy on same day", async () => {
		const { env, db } = createTestEnv();
		const sender = seedUser(db, { username: "Sender" });
		const receiver = seedUser(db, { username: "Receiver" });
		seedSession(db, sender.id, "streak-same-token");
		const { startOfTodayNY } = getStreakDateBoundaries();
		const streakStartDate = startOfTodayNY - 4 * 24 * 60 * 60;
		const lastOyCreatedAt = startOfTodayNY + 60;
		seedFriendship(db, sender.id, receiver.id);
		seedFriendship(db, receiver.id, sender.id);
		seedLastOyInfo(db, {
			userId: sender.id,
			friendId: receiver.id,
			lastOyCreatedAt,
			streakStartDate,
		});
		const { res, json } = await jsonRequest(env, "/api/oy", {
			method: "POST",
			headers: { "x-session-token": "streak-same-token" },
			body: { toUserId: receiver.id },
		});
		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		const lastOyInfo = db.lastOyInfo.find(
			(row) => row.user_id === sender.id && row.friend_id === receiver.id,
		);
		assert.equal(json.streak, 5);
		assert.equal(lastOyInfo?.streak_start_date, streakStartDate);
	});

	it("resets streak to 1 when sending oy after gap", async () => {
		const { env, db } = createTestEnv();
		const sender = seedUser(db, { username: "Sender" });
		const receiver = seedUser(db, { username: "Receiver" });
		seedSession(db, sender.id, "streak-reset-token");
		const { startOfTodayNY } = getStreakDateBoundaries();
		const lastOyCreatedAt = startOfTodayNY - 3 * 24 * 60 * 60;
		const streakStartDate = startOfTodayNY - 10 * 24 * 60 * 60;
		seedFriendship(db, sender.id, receiver.id);
		seedFriendship(db, receiver.id, sender.id);
		seedLastOyInfo(db, {
			userId: sender.id,
			friendId: receiver.id,
			lastOyCreatedAt,
			streakStartDate,
		});
		const { res, json } = await jsonRequest(env, "/api/oy", {
			method: "POST",
			headers: { "x-session-token": "streak-reset-token" },
			body: { toUserId: receiver.id },
		});
		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		const lastOyInfo = db.lastOyInfo.find(
			(row) => row.user_id === sender.id && row.friend_id === receiver.id,
		);
		assert.equal(json.streak, 1);
		assert.equal(lastOyInfo?.streak_start_date, startOfTodayNY);
	});

	it("creates location payloads and notification URLs for los", async () => {
		const { env, db } = createTestEnv();
		const sender = seedUser(db, { username: "Locator" });
		const receiver = seedUser(db, { username: "Tracker" });
		seedSession(db, sender.id, "lo-token");
		seedFriendship(db, sender.id, receiver.id);
		seedFriendship(db, receiver.id, sender.id);
		const { res, json } = await jsonRequest(env, "/api/lo", {
			method: "POST",
			headers: { "x-session-token": "lo-token" },
			body: { toUserId: receiver.id, location: { lat: 12.3, lon: 45.6 } },
		});
		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		const notificationPayload = JSON.parse(db.notifications[0].payload);
		assert.ok(notificationPayload.url.includes("expand=location"));
		assert.equal(notificationPayload.fromUserId, sender.id);
		assert.ok(Number.isFinite(notificationPayload.createdAt));
	});

	it("returns recent oys ordered and supports cursors", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Viewer" });
		const other = seedUser(db, { username: "Other" });
		seedSession(db, user.id, "oys-token");
		seedOy(db, {
			fromUserId: other.id,
			toUserId: user.id,
			type: "oy",
			createdAt: 100,
		});
		seedOy(db, {
			fromUserId: user.id,
			toUserId: other.id,
			type: "oy",
			createdAt: 120,
		});
		seedOy(db, {
			fromUserId: other.id,
			toUserId: user.id,
			type: "oy",
			createdAt: 110,
		});
		const { res, json } = await jsonRequest(env, "/api/oys", {
			headers: { "x-session-token": "oys-token" },
		});
		const body = json as {
			oys: Array<{ created_at: number }>;
			nextCursor: unknown;
		};
		assert.equal(res.status, 200);
		assert.equal(body.oys.length, 3);
		assert.equal(body.oys[0].created_at, 120);
		assert.equal(body.nextCursor, null);

		for (let i = 0; i < 31; i += 1) {
			seedOy(db, {
				fromUserId: other.id,
				toUserId: user.id,
				type: "oy",
				createdAt: 200 + i,
			});
		}
		const { json: paged } = await jsonRequest(env, "/api/oys", {
			headers: { "x-session-token": "oys-token" },
		});
		const pagedBody = paged as {
			oys: Array<unknown>;
			nextCursor: unknown;
		};
		assert.equal(pagedBody.oys.length, 30);
		assert.ok(pagedBody.nextCursor);
	});
});
