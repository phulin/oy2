import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonRequest } from "./testHelpers";
import { createTestEnv, seedPasskey, seedSession, seedUser } from "./testUtils";

describe("passkeys", () => {
	it("returns status for unauthenticated users", async () => {
		const { env } = createTestEnv();
		const { res, json } = await jsonRequest(env, "/api/auth/passkey/status");
		assert.equal(res.status, 200);
		assert.equal(json.hasPasskey, false);
	});

	it("lists passkeys for authenticated users", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "PasskeyUser" });
		seedSession(db, user.id, "passkey-token");
		seedPasskey(db, { userId: user.id, deviceName: "Laptop" });
		const { res, json } = await jsonRequest(env, "/api/auth/passkey/status", {
			headers: { "x-session-token": "passkey-token" },
		});
		assert.equal(res.status, 200);
		assert.equal(json.hasPasskey, true);
		const list = json.passkeys as Array<{ device_name: string }>;
		assert.equal(list.length, 1);
		assert.equal(list[0].device_name, "Laptop");
	});

	it("rejects invalid credential types during registration verify", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "KeyMaker" });
		seedSession(db, user.id, "register-token");
		await jsonRequest(env, "/api/auth/passkey/register/options", {
			method: "POST",
			headers: { "x-session-token": "register-token" },
		});

		const { res, json } = await jsonRequest(
			env,
			"/api/auth/passkey/register/verify",
			{
				method: "POST",
				headers: { "x-session-token": "register-token" },
				body: { credential: { type: "invalid" }, deviceName: "Device" },
			},
		);
		assert.equal(res.status, 400);
		assert.equal(json.error, "Invalid credential type");
	});

	it("deletes passkeys owned by the user", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Owner" });
		seedSession(db, user.id, "delete-token");
		const passkey = seedPasskey(db, { userId: user.id });
		const { res, json } = await jsonRequest(
			env,
			`/api/auth/passkey/${passkey.id}`,
			{
				method: "DELETE",
				headers: { "x-session-token": "delete-token" },
			},
		);
		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		assert.equal(db.passkeys.length, 0);
	});
});
