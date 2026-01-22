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
});
