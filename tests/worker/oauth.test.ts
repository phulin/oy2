import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSessionToken, request } from "./testHelpers";
import { createTestEnv, seedUser } from "./testUtils";

describe("oauth", () => {
	it("starts google oauth with state in KV", async () => {
		const { env, kv } = createTestEnv();
		const res = await request(env, "/api/auth/oauth/google");
		assert.equal(res.status, 302);
		const location = res.headers.get("location");
		assert.ok(location);
		const url = new URL(location ?? "");
		const state = url.searchParams.get("state");
		assert.ok(state);
		const stored = await kv.get(`oauth_state:${state}`);
		assert.ok(stored);
	});

	it("handles google callbacks for existing users", async (t) => {
		const { env, kv, db } = createTestEnv();
		const user = seedUser(db, {
			username: "OAuthUser",
			oauthProvider: "google",
			oauthSub: "sub-123",
		});
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (input) => {
			const url = typeof input === "string" ? input : input.url;
			if (url === "https://oauth2.googleapis.com/token") {
				return {
					ok: true,
					json: async () => ({ id_token: "token-123" }),
				} as Response;
			}
			if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
				return {
					ok: true,
					json: async () => ({
						aud: env.GOOGLE_CLIENT_ID,
						sub: "sub-123",
						email: "oauth@example.com",
					}),
				} as Response;
			}
			throw new Error(`Unexpected fetch: ${url}`);
		};
		t.after(() => {
			globalThis.fetch = originalFetch;
		});

		const startRes = await request(env, "/api/auth/oauth/google");
		const startLocation = startRes.headers.get("location") ?? "";
		const state = new URL(startLocation).searchParams.get("state") ?? "";

		const res = await request(
			env,
			`/api/auth/oauth/callback?state=${state}&code=auth-code`,
		);
		assert.equal(res.status, 302);
		assert.equal(res.headers.get("location"), "/?passkey_setup=1");
		assert.ok(getSessionToken(res));
		assert.equal(db.sessions.length, 1);
		assert.equal(db.sessions[0].user_id, user.id);
		assert.equal(await kv.get(`oauth_state:${state}`), null);
	});
});
