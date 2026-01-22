import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCookieValue, getSessionToken, jsonRequest } from "./testHelpers";
import { createTestEnv, seedSession, seedUser } from "./testUtils";

describe("email auth", () => {
	it("sends verification codes for valid emails", async (t) => {
		const { env, kv } = createTestEnv();
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			({ ok: true, json: async () => ({}) }) as Response;
		t.after(() => {
			globalThis.fetch = originalFetch;
		});

		const email = "person@example.com";
		const { res, json } = await jsonRequest(env, "/api/auth/email/send-code", {
			method: "POST",
			body: { email },
		});
		assert.equal(res.status, 200);
		assert.equal(json.status, "code_sent");
		const stored = await kv.get(`email_code:${email}`);
		assert.ok(stored);
		const data = JSON.parse(stored ?? "{}") as { code?: string };
		assert.equal(data.code?.length, 6);
	});

	it("authenticates existing users with valid codes", async () => {
		const { env, kv, db } = createTestEnv();
		const email = "signedin@example.com";
		const user = seedUser(db, { username: "SignedIn", email });
		await kv.put(
			`email_code:${email}`,
			JSON.stringify({ code: "123456", attempts: 0 }),
		);

		const { res, json } = await jsonRequest(env, "/api/auth/email/verify", {
			method: "POST",
			body: { email, code: "123456" },
		});
		const body = json as { status: string; user: { id: number } };
		assert.equal(res.status, 200);
		assert.equal(body.status, "authenticated");
		assert.equal(body.user.id, user.id);
		assert.ok(getSessionToken(res));
	});

	it("creates new users after completing registration", async () => {
		const { env, kv, db } = createTestEnv();
		const email = "new@example.com";
		await kv.put(
			`email_code:${email}`,
			JSON.stringify({ code: "654321", attempts: 0 }),
		);

		const { res, json } = await jsonRequest(env, "/api/auth/email/verify", {
			method: "POST",
			body: { email, code: "654321" },
		});
		assert.equal(res.status, 200);
		assert.equal(json.status, "choose_username");
		const pendingId = getCookieValue(res, "email_pending");
		assert.ok(pendingId);

		const { res: completeRes, json: completeJson } = await jsonRequest(
			env,
			"/api/auth/email/complete",
			{
				method: "POST",
				headers: { cookie: `email_pending=${pendingId}` },
				body: { username: "new_user" },
			},
		);
		const completeBody = completeJson as { user: { id: number } };
		assert.equal(completeRes.status, 200);
		assert.ok(completeBody.user.id);
		assert.ok(getSessionToken(completeRes));
		assert.equal(db.users.length, 1);
		assert.equal(db.users[0].email, email);
	});

	it("links email for authenticated users", async (t) => {
		const { env, kv, db } = createTestEnv();
		const user = seedUser(db, { username: "Emailer" });
		seedSession(db, user.id, "email-token");
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			({ ok: true, json: async () => ({}) }) as Response;
		t.after(() => {
			globalThis.fetch = originalFetch;
		});

		const email = "linked@example.com";
		const { res: sendRes, json: sendJson } = await jsonRequest(
			env,
			"/api/auth/email/add/send-code",
			{
				method: "POST",
				headers: { "x-session-token": "email-token" },
				body: { email },
			},
		);
		assert.equal(sendRes.status, 200);
		assert.equal(sendJson.status, "code_sent");

		const stored = await kv.get(`email_add:${user.id}`);
		const data = JSON.parse(stored ?? "{}") as { code?: string; email?: string };
		assert.equal(data.email, email);
		assert.ok(data.code);

		const { res: verifyRes, json: verifyJson } = await jsonRequest(
			env,
			"/api/auth/email/add/verify",
			{
				method: "POST",
				headers: { "x-session-token": "email-token" },
				body: { code: data.code },
			},
		);
		assert.equal(verifyRes.status, 200);
		assert.equal(verifyJson.status, "email_updated");
		assert.equal(verifyJson.email, email);
		assert.equal(db.users[0].email, email);
		assert.equal(await kv.get(`email_add:${user.id}`), null);
	});
});
