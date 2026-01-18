import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonRequest } from "./testHelpers";
import {
	createTestEnv,
	getStreakDateBoundaries,
	seedFriendship,
	seedSession,
	seedUser,
	seedYo,
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

	it("returns a friends list with last yo fields", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Main" });
		const friend = seedUser(db, { username: "Pal" });
		seedSession(db, user.id, "friends-list-token");
		seedFriendship(db, user.id, friend.id);
		seedFriendship(db, friend.id, user.id);
		const yo = seedYo(db, {
			fromUserId: friend.id,
			toUserId: user.id,
			type: "oy",
		});
		const friendship = db.friendships.find(
			(row) => row.user_id === user.id && row.friend_id === friend.id,
		);
		if (friendship) {
			friendship.last_yo_id = yo.id;
			friendship.last_yo_type = "oy";
			friendship.last_yo_created_at = yo.created_at;
			friendship.last_yo_from_user_id = friend.id;
		}
		const { res, json } = await jsonRequest(env, "/api/friends", {
			headers: { "x-session-token": "friends-list-token" },
		});
		const body = json as {
			friends: Array<{ last_yo_type: string | null }>;
		};
		assert.equal(res.status, 200);
		assert.equal(body.friends.length, 1);
		assert.equal(body.friends[0].last_yo_type, "oy");
	});

	it("returns streak in friends list", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Main" });
		const friend = seedUser(db, { username: "Pal" });
		seedSession(db, user.id, "streak-token");
		const { startOfTodayNY } = getStreakDateBoundaries();
		const streakStartDate = startOfTodayNY - 4 * 24 * 60 * 60;
		const lastYoCreatedAt = startOfTodayNY + 60;
		seedFriendship(db, user.id, friend.id, {
			lastYoCreatedAt,
			streakStartDate,
		});
		seedFriendship(db, friend.id, user.id, {
			lastYoCreatedAt,
			streakStartDate,
		});
		const { res, json } = await jsonRequest(env, "/api/friends", {
			headers: { "x-session-token": "streak-token" },
		});
		const body = json as {
			friends: Array<{ streak: number }>;
		};
		assert.equal(res.status, 200);
		assert.equal(body.friends.length, 1);
		assert.equal(body.friends[0].streak, 5);
	});

	it("returns streak 0 when last yo is stale", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Main" });
		const friend = seedUser(db, { username: "Pal" });
		seedSession(db, user.id, "stale-streak-token");
		const { startOfTodayNY } = getStreakDateBoundaries();
		const lastYoCreatedAt = startOfTodayNY - 3 * 24 * 60 * 60;
		const streakStartDate = startOfTodayNY - 10 * 24 * 60 * 60;
		seedFriendship(db, user.id, friend.id, {
			lastYoCreatedAt,
			streakStartDate,
		});
		seedFriendship(db, friend.id, user.id, {
			lastYoCreatedAt,
			streakStartDate,
		});
		const { res, json } = await jsonRequest(env, "/api/friends", {
			headers: { "x-session-token": "stale-streak-token" },
		});
		const body = json as {
			friends: Array<{ streak: number }>;
		};
		assert.equal(res.status, 200);
		assert.equal(body.friends.length, 1);
		assert.equal(body.friends[0].streak, 0);
	});
});
