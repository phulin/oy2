import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonRequest } from "./testHelpers";
import { createTestEnv, seedSession, seedUser } from "./testUtils";

describe("dsar", () => {
	it("rejects unauthenticated submissions", async () => {
		const { env } = createTestEnv();
		const { res, json } = await jsonRequest(env, "/api/dsar", {
			method: "POST",
			body: {
				requestType: "access",
				jurisdiction: "US-CA",
				details: "Provide a copy of all data.",
			},
		});

		assert.equal(res.status, 401);
		assert.equal(json.error, "Not authenticated");
	});

	it("validates required fields", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "DsarUser", email: "u@example.com" });
		seedSession(db, user.id, "dsar-token");

		const { res, json } = await jsonRequest(env, "/api/dsar", {
			method: "POST",
			headers: { "x-session-token": "dsar-token" },
			body: {
				requestType: "access",
				jurisdiction: "",
				details: "",
			},
		});

		assert.equal(res.status, 400);
		assert.equal(json.error, "Jurisdiction is required");
	});

	it("submits a DSAR email for authenticated users", async (t) => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "DsarUser", email: "u@example.com" });
		seedSession(db, user.id, "dsar-token");

		let emailPayload: Record<string, unknown> | null = null;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (_input, init) => {
			if (init?.body && typeof init.body === "string") {
				emailPayload = JSON.parse(init.body) as Record<string, unknown>;
			}
			return { ok: true, json: async () => ({ id: "email_123" }) } as Response;
		};
		t.after(() => {
			globalThis.fetch = originalFetch;
		});

		const { res, json } = await jsonRequest(env, "/api/dsar", {
			method: "POST",
			headers: { "x-session-token": "dsar-token" },
			body: {
				requestType: "delete",
				jurisdiction: "US-CA",
				details: "Please delete all account data.",
			},
		});

		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		assert.ok(emailPayload);
		assert.deepEqual(emailPayload?.to, ["contact@oyme.site"]);
		assert.match(String(emailPayload?.subject), /DSAR delete request/);
	});
});
