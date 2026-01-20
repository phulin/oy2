import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonRequest } from "./testHelpers";
import {
	createTestEnv,
	getStreakDateBoundaries,
	seedFriendship,
	seedLastYoInfo,
	seedSession,
	seedUser,
} from "./testUtils";

describe("friends", () => {
	it("adds friends bidirectionally", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Host" });
		const friend = seedUser(db, { username: "Guest" });
		seedSession(db, user.id, "friend-token");
		const { res, json } = await jsonRequest(env, "/api/friends", {
			method: "POST",
			headers: { "x-session-token": "friend-token" },
			body: { friendId: friend.id },
		});
		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		assert.equal(db.friendships.length, 2);
	});

	it("returns a friends list", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Main" });
		const friend = seedUser(db, { username: "Pal" });
		seedSession(db, user.id, "friends-list-token");
		seedFriendship(db, user.id, friend.id);
		seedFriendship(db, friend.id, user.id);
		const { res, json } = await jsonRequest(env, "/api/friends", {
			headers: { "x-session-token": "friends-list-token" },
		});
		const body = json as {
			friends: Array<{ id: number; username: string }>;
		};
		assert.equal(res.status, 200);
		assert.equal(body.friends.length, 1);
		assert.equal(body.friends[0].id, friend.id);
		assert.equal(body.friends[0].username, "Pal");
	});

	it("returns last yo info", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Main" });
		const friend = seedUser(db, { username: "Pal" });
		seedSession(db, user.id, "last-yo-token");
		const { startOfTodayNY } = getStreakDateBoundaries();
		const lastYoCreatedAt = startOfTodayNY + 60;
		seedLastYoInfo(db, {
			userId: user.id,
			friendId: friend.id,
			lastYoType: "oy",
			lastYoCreatedAt,
			lastYoFromUserId: friend.id,
			streakStartDate: startOfTodayNY,
		});
		const { res, json } = await jsonRequest(env, "/api/last-yo-info", {
			headers: { "x-session-token": "last-yo-token" },
		});
		const body = json as {
			lastYoInfo: Array<{
				friend_id: number;
				last_yo_type: string | null;
				last_yo_created_at: number | null;
				last_yo_from_user_id: number | null;
				streak: number;
			}>;
		};
		assert.equal(res.status, 200);
		assert.equal(body.lastYoInfo.length, 1);
		assert.equal(body.lastYoInfo[0].friend_id, friend.id);
		assert.equal(body.lastYoInfo[0].last_yo_type, "oy");
		assert.equal(body.lastYoInfo[0].last_yo_created_at, lastYoCreatedAt);
		assert.equal(body.lastYoInfo[0].last_yo_from_user_id, friend.id);
		assert.equal(body.lastYoInfo[0].streak, 1);
	});

	it("returns streak in last yo info", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Main" });
		const friend = seedUser(db, { username: "Pal" });
		seedSession(db, user.id, "streak-token");
		const { startOfTodayNY } = getStreakDateBoundaries();
		const streakStartDate = startOfTodayNY - 4 * 24 * 60 * 60;
		const lastYoCreatedAt = startOfTodayNY + 60;
		seedLastYoInfo(db, {
			userId: user.id,
			friendId: friend.id,
			lastYoCreatedAt,
			streakStartDate,
		});
		const { res, json } = await jsonRequest(env, "/api/last-yo-info", {
			headers: { "x-session-token": "streak-token" },
		});
		const body = json as {
			lastYoInfo: Array<{ streak: number }>;
		};
		assert.equal(res.status, 200);
		assert.equal(body.lastYoInfo.length, 1);
		assert.equal(body.lastYoInfo[0].streak, 5);
	});

	it("returns streak 0 when last yo is stale", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Main" });
		const friend = seedUser(db, { username: "Pal" });
		seedSession(db, user.id, "stale-streak-token");
		const { startOfTodayNY } = getStreakDateBoundaries();
		const lastYoCreatedAt = startOfTodayNY - 3 * 24 * 60 * 60;
		const streakStartDate = startOfTodayNY - 10 * 24 * 60 * 60;
		seedLastYoInfo(db, {
			userId: user.id,
			friendId: friend.id,
			lastYoCreatedAt,
			streakStartDate,
		});
		const { res, json } = await jsonRequest(env, "/api/last-yo-info", {
			headers: { "x-session-token": "stale-streak-token" },
		});
		const body = json as {
			lastYoInfo: Array<{ streak: number }>;
		};
		assert.equal(res.status, 200);
		assert.equal(body.lastYoInfo.length, 1);
		assert.equal(body.lastYoInfo[0].streak, 0);
	});
});
