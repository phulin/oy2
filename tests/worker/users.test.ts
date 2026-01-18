import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonRequest } from "./testHelpers";
import { createTestEnv, seedFriendship, seedSession, seedUser } from "./testUtils";

describe("users", () => {
	it("creates a user if missing", async () => {
		const { env, db } = createTestEnv();
		const { res, json } = await jsonRequest(env, "/api/users", {
			method: "POST",
			body: { username: "Nova" },
		});
		const body = json as { user: { username: string } };
		assert.equal(res.status, 200);
		assert.equal(body.user.username, "Nova");
		assert.equal(db.users.length, 1);
	});

	it("returns existing user for duplicate usernames", async () => {
		const { env, db } = createTestEnv();
		seedUser(db, { username: "Nova" });
		const { res, json } = await jsonRequest(env, "/api/users", {
			method: "POST",
			body: { username: "Nova" },
		});
		const body = json as { user: { username: string } };
		assert.equal(res.status, 200);
		assert.equal(body.user.username, "Nova");
		assert.equal(db.users.length, 1);
	});

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
});
