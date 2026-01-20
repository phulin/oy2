import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSessionToken, jsonRequest, setOtpFetchMock } from "./testHelpers";
import { createTestEnv, seedSession, seedUser } from "./testUtils";

describe("auth", () => {
	it("rejects invalid usernames", async () => {
		const { env } = createTestEnv();
		const { res, json } = await jsonRequest(env, "/api/auth/start", {
			method: "POST",
			body: { username: "a" },
		});
		assert.equal(res.status, 400);
		assert.equal(json.error, "Username must be 2-20 characters");
	});

	it("authenticates immediately when phone auth disabled", async () => {
		const { env, db, kv } = createTestEnv();
		await kv.put("settings:phone_auth_enabled", "false");
		const { res, json } = await jsonRequest(env, "/api/auth/start", {
			method: "POST",
			body: { username: "Otto", phone: "+15555555555" },
		});
		const body = json as { status: string; user: { username: string } };
		assert.equal(res.status, 200);
		assert.equal(body.status, "authenticated");
		assert.equal(body.user.username, "Otto");
		assert.ok(getSessionToken(res));
		assert.equal(db.users.length, 1);
		assert.equal(db.sessions.length, 1);
	});

	it("returns needs_phone when phone auth enabled and no phone provided", async () => {
		const { env, db } = createTestEnv();
		const { res, json } = await jsonRequest(env, "/api/auth/start", {
			method: "POST",
			body: { username: "Newbie" },
		});
		assert.equal(res.status, 200);
		assert.equal(json.status, "needs_phone");
		assert.equal(db.users.length, 0);
	});

	it("rejects phone submissions when phone already set", async () => {
		const { env, db } = createTestEnv();
		seedUser(db, { username: "Rae", phone: "+14155550101" });
		const { res, json } = await jsonRequest(env, "/api/auth/phone", {
			method: "POST",
			body: { username: "Rae", phone: "+14155550102" },
		});
		assert.equal(res.status, 400);
		assert.equal(json.error, "Phone number already set");
	});

	it("rejects phone submissions for missing users", async () => {
		const { env } = createTestEnv();
		const { res, json } = await jsonRequest(env, "/api/auth/phone", {
			method: "POST",
			body: { username: "Rae", phone: "+14155550101" },
		});
		assert.equal(res.status, 404);
		assert.equal(json.error, "User not found");
	});

	it("accepts phone submissions and sends OTP", async (t) => {
		const { env, db } = createTestEnv();
		seedUser(db, { username: "Rae" });
		setOtpFetchMock(t);
		const { res, json } = await jsonRequest(env, "/api/auth/phone", {
			method: "POST",
			body: { username: "Rae", phone: "+14155550101" },
		});
		assert.equal(res.status, 200);
		assert.equal(json.status, "code_sent");
		assert.equal(db.users.length, 1);
		assert.equal(db.users[0].phone, "+14155550101");
		assert.equal(db.users[0].phone_verified, 0);
	});

	it("sends OTP when phone auth enabled and user has a phone", async (t) => {
		const { env, db } = createTestEnv();
		seedUser(db, { username: "Mira", phone: "+14155552671" });
		setOtpFetchMock(t);
		const { res, json } = await jsonRequest(env, "/api/auth/start", {
			method: "POST",
			body: { username: "Mira" },
		});
		assert.equal(res.status, 200);
		assert.equal(json.status, "code_sent");
	});

	it("rejects missing verification payload", async () => {
		const { env } = createTestEnv();
		const { res, json } = await jsonRequest(env, "/api/auth/verify", {
			method: "POST",
			body: { username: "", otp: "" },
		});
		assert.equal(res.status, 400);
		assert.equal(json.error, "Missing verification code");
	});

	it("returns not found for unknown users", async () => {
		const { env } = createTestEnv();
		const { res, json } = await jsonRequest(env, "/api/auth/verify", {
			method: "POST",
			body: { username: "Missing", otp: "1234" },
		});
		assert.equal(res.status, 404);
		assert.equal(json.error, "User not found");
	});

	it("bypasses OTP verification when phone auth disabled", async () => {
		const { env, db, kv } = createTestEnv();
		await kv.put("settings:phone_auth_enabled", "false");
		seedUser(db, { username: "Nina" });
		const { res, json } = await jsonRequest(env, "/api/auth/verify", {
			method: "POST",
			body: { username: "Nina", otp: "1234" },
		});
		const body = json as { user: { username: string } };
		assert.equal(res.status, 200);
		assert.equal(body.user.username, "Nina");
		assert.ok(getSessionToken(res));
	});

	it("rejects invalid OTPs", async (t) => {
		const { env, db } = createTestEnv();
		seedUser(db, { username: "Kai", phone: "+14155551234" });
		setOtpFetchMock(t, { verify: { success: true, isValidOtp: false } });
		const { res, json } = await jsonRequest(env, "/api/auth/verify", {
			method: "POST",
			body: { username: "Kai", otp: "0000" },
		});
		assert.equal(res.status, 400);
		assert.equal(json.error, "Invalid verification code");
	});

	it("creates sessions on successful OTP verification", async (t) => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Tess", phone: "+14155550000" });
		setOtpFetchMock(t);
		const { res, json } = await jsonRequest(env, "/api/auth/verify", {
			method: "POST",
			body: { username: "Tess", otp: "123456" },
		});
		const body = json as { user: { username: string } };
		assert.equal(res.status, 200);
		assert.equal(body.user.username, "Tess");
		assert.ok(getSessionToken(res));
		const updated = db.users.find((row) => row.id === user.id);
		assert.equal(updated?.phone_verified, 1);
		assert.equal(db.sessions.length, 1);
	});

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
