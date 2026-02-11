import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonRequest } from "./testHelpers";
import { createTestEnv, seedFriendship, seedSession, seedUser } from "./testUtils";

describe("users", () => {
	it("searches users case-insensitively", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Ada" });
		seedSession(db, user.id, "search-token");
		seedUser(db, { username: "ALICE" });
		seedUser(db, { username: "Bob" });
		const { res, json } = await jsonRequest(env, "/api/users/search?q=al", {
			headers: { "x-session-token": "search-token" },
		});
		const body = json as { users: Array<{ username: string }> };
		assert.equal(res.status, 200);
		assert.equal(body.users.length, 1);
		assert.equal(body.users[0].username, "ALICE");
	});

	it("returns suggestions based on mutual friends", async () => {
		const { env, db } = createTestEnv();
		const me = seedUser(db, { username: "Me" });
		const friendA = seedUser(db, { username: "FriendA" });
		const friendB = seedUser(db, { username: "FriendB" });
		const candidateOne = seedUser(db, { username: "Candidate1" });
		const candidateTwo = seedUser(db, { username: "Candidate2" });
		seedSession(db, me.id, "suggest-token");

		seedFriendship(db, me.id, friendA.id);
		seedFriendship(db, me.id, friendB.id);
		seedFriendship(db, friendA.id, me.id);
		seedFriendship(db, friendB.id, me.id);
		seedFriendship(db, candidateOne.id, friendA.id);
		seedFriendship(db, candidateTwo.id, friendA.id);
		seedFriendship(db, candidateTwo.id, friendB.id);

		const { res, json } = await jsonRequest(env, "/api/users/suggested", {
			headers: { "x-session-token": "suggest-token" },
		});
		const body = json as {
			users: Array<{ username: string; mutuals: number }>;
		};
		assert.equal(res.status, 200);
		assert.equal(body.users[0].username, "Candidate2");
		assert.equal(body.users[0].mutuals, 2);
		assert.equal(body.users[1].username, "Candidate1");
		assert.equal(body.users[1].mutuals, 1);
	});

	it("returns mutual usernames for suggested users", async () => {
		const { env, db } = createTestEnv();
		const me = seedUser(db, { username: "Me" });
		const friendA = seedUser(db, { username: "FriendA" });
		const friendB = seedUser(db, { username: "FriendB" });
		const candidateOne = seedUser(db, { username: "Candidate1" });
		const candidateTwo = seedUser(db, { username: "Candidate2" });
		seedSession(db, me.id, "mutuals-token");

		seedFriendship(db, me.id, friendA.id);
		seedFriendship(db, me.id, friendB.id);
		seedFriendship(db, friendA.id, me.id);
		seedFriendship(db, friendB.id, me.id);
		seedFriendship(db, candidateOne.id, friendA.id);
		seedFriendship(db, candidateTwo.id, friendA.id);
		seedFriendship(db, candidateTwo.id, friendB.id);

		const { res, json } = await jsonRequest(
			env,
			"/api/users/suggested/mutuals",
			{
				method: "POST",
				body: { userIds: [candidateOne.id, candidateTwo.id] },
				headers: { "x-session-token": "mutuals-token" },
			},
		);
		const body = json as {
			mutuals: Record<number, string[]>;
		};
		assert.equal(res.status, 200);
		assert.deepEqual(body.mutuals[String(candidateOne.id)], ["FriendA"]);
		assert.deepEqual(body.mutuals[String(candidateTwo.id)], [
			"FriendA",
			"FriendB",
		]);
	});

	it("excludes blocked users from search results", async () => {
		const { env, db } = createTestEnv();
		const me = seedUser(db, { username: "Me" });
		const blocked = seedUser(db, { username: "AliceBlocked" });
		seedSession(db, me.id, "search-block-token");

		await jsonRequest(env, `/api/friends/${blocked.id}/block`, {
			method: "POST",
			headers: { "x-session-token": "search-block-token" },
		});

		const { res, json } = await jsonRequest(env, "/api/users/search?q=ali", {
			headers: { "x-session-token": "search-block-token" },
		});
		const body = json as { users: Array<{ id: number }> };
		assert.equal(res.status, 200);
		assert.equal(body.users.length, 0);
	});

	it("excludes blocked users from suggestions", async () => {
		const { env, db } = createTestEnv();
		const me = seedUser(db, { username: "Me" });
		const friend = seedUser(db, { username: "FriendA" });
		const blockedCandidate = seedUser(db, { username: "CandidateBlocked" });
		seedSession(db, me.id, "suggest-block-token");

		seedFriendship(db, me.id, friend.id);
		seedFriendship(db, friend.id, me.id);
		seedFriendship(db, blockedCandidate.id, friend.id);

		await jsonRequest(env, `/api/friends/${blockedCandidate.id}/block`, {
			method: "POST",
			headers: { "x-session-token": "suggest-block-token" },
		});

		const { res, json } = await jsonRequest(env, "/api/users/suggested", {
			headers: { "x-session-token": "suggest-block-token" },
		});
		const body = json as { users: Array<{ id: number }> };
		assert.equal(res.status, 200);
		assert.equal(body.users.length, 0);
	});

	it("allows unblocking users", async () => {
		const { env, db } = createTestEnv();
		const me = seedUser(db, { username: "Me" });
		const other = seedUser(db, { username: "Other" });
		seedSession(db, me.id, "unblock-token");

		await jsonRequest(env, `/api/friends/${other.id}/block`, {
			method: "POST",
			headers: { "x-session-token": "unblock-token" },
		});
		assert.equal(db.userBlocks.length, 1);

		const { res, json } = await jsonRequest(
			env,
			`/api/users/block/${other.id}`,
			{
				method: "DELETE",
				headers: { "x-session-token": "unblock-token" },
			},
		);

		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		assert.equal(db.userBlocks.length, 0);
	});

	it("lists blocked users for the current user", async () => {
		const { env, db } = createTestEnv();
		const me = seedUser(db, { username: "Me" });
		const blockedA = seedUser(db, { username: "BlockedA" });
		const blockedB = seedUser(db, { username: "BlockedB" });
		seedSession(db, me.id, "blocked-list-token");

		await jsonRequest(env, `/api/friends/${blockedA.id}/block`, {
			method: "POST",
			headers: { "x-session-token": "blocked-list-token" },
		});
		await jsonRequest(env, `/api/friends/${blockedB.id}/block`, {
			method: "POST",
			headers: { "x-session-token": "blocked-list-token" },
		});

		const { res, json } = await jsonRequest(env, "/api/users/blocked", {
			headers: { "x-session-token": "blocked-list-token" },
		});
		const body = json as {
			users: Array<{ id: number; username: string; blocked_at: number }>;
		};

		assert.equal(res.status, 200);
		assert.equal(body.users.length, 2);
		assert.deepEqual(
			body.users.map((item) => item.id).sort((a, b) => a - b),
			[blockedA.id, blockedB.id].sort((a, b) => a - b),
		);
		assert.ok(body.users.every((item) => Number.isFinite(item.blocked_at)));
	});
});
