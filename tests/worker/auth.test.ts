import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonRequest } from "./testHelpers";
import { createTestEnv, seedSession, seedUser } from "./testUtils";

describe("auth", () => {
	it("returns the current session user", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Zed" });
		seedSession(db, user.id, "session-token");
		const { res, json } = await jsonRequest(env, "/api/auth/session", {
			headers: { "x-session-token": "session-token" },
		});
		const body = json as { user: { username: string } };
		assert.equal(res.status, 200);
		assert.equal(body.user.username, "Zed");
	});

	it("logs out and clears sessions", async () => {
		const { env, db, kv } = createTestEnv();
		const user = seedUser(db, { username: "Tori" });
		seedSession(db, user.id, "logout-token");
		await kv.put("session:logout-token", JSON.stringify(user));
		const { res, json } = await jsonRequest(env, "/api/auth/logout", {
			method: "POST",
			headers: { "x-session-token": "logout-token" },
		});
		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		assert.equal(db.sessions.length, 0);
	});

	it("deletes account when authenticated", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "DeleteMe" });
		seedSession(db, user.id, "delete-token");

		const { res, json } = await jsonRequest(env, "/api/auth/account", {
			method: "DELETE",
			headers: { "x-session-token": "delete-token" },
		});

		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		assert.equal(db.users.find((row) => row.id === user.id), undefined);
	});

	it("rejects unauthenticated account deletion", async () => {
		const { env } = createTestEnv();
		const { res, json } = await jsonRequest(env, "/api/auth/account", {
			method: "DELETE",
		});

		assert.equal(res.status, 401);
		assert.equal(json.error, "Not authenticated");
	});

	it("rejects profane usernames in availability checks", async () => {
		const { env } = createTestEnv();
		const { res, json } = await jsonRequest(env, "/api/auth/username/check", {
			method: "POST",
			body: { username: "fuckface" },
		});

		assert.equal(res.status, 400);
		assert.equal(json.available, false);
		assert.equal(json.error, "Username contains disallowed language");
	});
});
