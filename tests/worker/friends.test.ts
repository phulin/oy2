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
		const body = json as { friend: { id: number; username: string } };
		assert.equal(res.status, 200);
		assert.equal(body.friend.id, friend.id);
		assert.equal(body.friend.username, "Guest");
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
			friends: Array<{ id: number; username: string; nickname: string | null }>;
		};
		assert.equal(res.status, 200);
		assert.equal(body.friends.length, 1);
		assert.equal(body.friends[0].id, friend.id);
		assert.equal(body.friends[0].username, "Pal");
		assert.equal(body.friends[0].nickname, null);
	});

	it("updates friend nickname", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Main" });
		const friend = seedUser(db, { username: "Pal" });
		seedSession(db, user.id, "friend-nickname-token");
		seedFriendship(db, user.id, friend.id);
		seedFriendship(db, friend.id, user.id);

		const { res, json } = await jsonRequest(
			env,
			`/api/friends/${friend.id}/nickname`,
			{
				method: "PATCH",
				headers: { "x-session-token": "friend-nickname-token" },
				body: { nickname: "Bestie" },
			},
		);

		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		assert.equal(json.nickname, "Bestie");
		const friendship = db.friendships.find(
			(row) => row.user_id === user.id && row.friend_id === friend.id,
		);
		assert.equal(friendship?.nickname, "Bestie");
	});

	it("returns last oy info", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Main" });
		const friend = seedUser(db, { username: "Pal" });
		seedSession(db, user.id, "last-oy-token");
		const { startOfTodayNY } = getStreakDateBoundaries();
		const lastOyCreatedAt = startOfTodayNY + 60;
		seedLastOyInfo(db, {
			userId: user.id,
			friendId: friend.id,
			lastOyType: "oy",
			lastOyCreatedAt,
			lastOyFromUserId: friend.id,
			streakStartDate: startOfTodayNY,
		});
		const { res, json } = await jsonRequest(env, "/api/last-oy-info", {
			headers: { "x-session-token": "last-oy-token" },
		});
		const body = json as {
			lastOyInfo: Array<{
				friend_id: number;
				last_oy_type: string | null;
				last_oy_created_at: number | null;
				last_oy_from_user_id: number | null;
				streak: number;
			}>;
		};
		assert.equal(res.status, 200);
		assert.equal(body.lastOyInfo.length, 1);
		assert.equal(body.lastOyInfo[0].friend_id, friend.id);
		assert.equal(body.lastOyInfo[0].last_oy_type, "oy");
		assert.equal(body.lastOyInfo[0].last_oy_created_at, lastOyCreatedAt);
		assert.equal(body.lastOyInfo[0].last_oy_from_user_id, friend.id);
		assert.equal(body.lastOyInfo[0].streak, 1);
	});

	it("returns streak in last oy info", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Main" });
		const friend = seedUser(db, { username: "Pal" });
		seedSession(db, user.id, "streak-token");
		const { startOfTodayNY } = getStreakDateBoundaries();
		const streakStartDate = startOfTodayNY - 4 * 24 * 60 * 60;
		const lastOyCreatedAt = startOfTodayNY + 60;
		seedLastOyInfo(db, {
			userId: user.id,
			friendId: friend.id,
			lastOyCreatedAt,
			streakStartDate,
		});
		const { res, json } = await jsonRequest(env, "/api/last-oy-info", {
			headers: { "x-session-token": "streak-token" },
		});
		const body = json as {
			lastOyInfo: Array<{ streak: number }>;
		};
		assert.equal(res.status, 200);
		assert.equal(body.lastOyInfo.length, 1);
		assert.equal(body.lastOyInfo[0].streak, 5);
	});

	it("returns streak 0 when last oy is stale", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Main" });
		const friend = seedUser(db, { username: "Pal" });
		seedSession(db, user.id, "stale-streak-token");
		const { startOfTodayNY } = getStreakDateBoundaries();
		const lastOyCreatedAt = startOfTodayNY - 3 * 24 * 60 * 60;
		const streakStartDate = startOfTodayNY - 10 * 24 * 60 * 60;
		seedLastOyInfo(db, {
			userId: user.id,
			friendId: friend.id,
			lastOyCreatedAt,
			streakStartDate,
		});
		const { res, json } = await jsonRequest(env, "/api/last-oy-info", {
			headers: { "x-session-token": "stale-streak-token" },
		});
		const body = json as {
			lastOyInfo: Array<{ streak: number }>;
		};
		assert.equal(res.status, 200);
		assert.equal(body.lastOyInfo.length, 1);
		assert.equal(body.lastOyInfo[0].streak, 0);
	});

	it("rejects reports with disallowed language", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Main" });
		const friend = seedUser(db, { username: "Pal" });
		seedSession(db, user.id, "report-filter-token");

		const { res, json } = await jsonRequest(
			env,
			`/api/friends/${friend.id}/report`,
			{
				method: "POST",
				headers: { "x-session-token": "report-filter-token" },
				body: {
					reason: "fuck",
					details: "contains slur",
				},
			},
		);

		assert.equal(res.status, 400);
		assert.equal(json.error, "Report contains disallowed language");
	});
});
