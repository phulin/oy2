import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonRequest } from "./testHelpers";
import {
	createTestEnv,
	getStreakDateBoundaries,
	seedFriendship,
	seedLastOyInfo,
	seedSession,
	seedUser,
	seedOy,
} from "./testUtils";

function toPem(pkcs8: ArrayBuffer) {
	const base64 = Buffer.from(pkcs8).toString("base64");
	const lines = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
	return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

async function createRsaPrivateKeyPem() {
	const pair = await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);
	const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
	return toPem(pkcs8);
}

async function createEcPrivateKeyPem() {
	const pair = await crypto.subtle.generateKey(
		{
			name: "ECDSA",
			namedCurve: "P-256",
		},
		true,
		["sign", "verify"],
	);
	const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
	return toPem(pkcs8);
}

describe("oys and los", () => {
	it("prevents sending to non-friends", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Sender" });
		const target = seedUser(db, { username: "Target" });
		seedSession(db, user.id, "send-token");
		const { res, json } = await jsonRequest(env, "/api/oy", {
			method: "POST",
			headers: { "x-session-token": "send-token" },
			body: { toUserId: target.id },
		});
		assert.equal(res.status, 403);
		assert.equal(json.error, "You can only send Oys to friends");
	});

	it("creates oy, notifications, and last oy info updates", async () => {
		const { env, db } = createTestEnv();
		const sender = seedUser(db, { username: "Sender" });
		const receiver = seedUser(db, { username: "Receiver" });
		seedSession(db, sender.id, "oy-token");
		seedFriendship(db, sender.id, receiver.id);
		seedFriendship(db, receiver.id, sender.id);
		const { res, json } = await jsonRequest(env, "/api/oy", {
			method: "POST",
			headers: { "x-session-token": "oy-token" },
			body: { toUserId: receiver.id },
		});
		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		assert.equal(db.oys.length, 1);
		assert.equal(db.notifications.length, 1);
		assert.equal(db.lastOyInfo.length, 2);
		const lastOyInfo = db.lastOyInfo.find(
			(row) => row.user_id === sender.id && row.friend_id === receiver.id,
		);
		assert.equal(lastOyInfo?.last_oy_type, "oy");
	});

	it("increments streak when sending oy day after last oy", async () => {
		const { env, db } = createTestEnv();
		const sender = seedUser(db, { username: "Sender" });
		const receiver = seedUser(db, { username: "Receiver" });
		seedSession(db, sender.id, "streak-inc-token");
		const { startOfTodayNY, startOfYesterdayNY } = getStreakDateBoundaries();
		const streakStartDate = startOfYesterdayNY - 2 * 24 * 60 * 60;
		const lastOyCreatedAt = startOfYesterdayNY + 60;
		seedFriendship(db, sender.id, receiver.id);
		seedFriendship(db, receiver.id, sender.id);
		seedLastOyInfo(db, {
			userId: sender.id,
			friendId: receiver.id,
			lastOyCreatedAt,
			streakStartDate,
		});
		const { res, json } = await jsonRequest(env, "/api/oy", {
			method: "POST",
			headers: { "x-session-token": "streak-inc-token" },
			body: { toUserId: receiver.id },
		});
		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		const lastOyInfo = db.lastOyInfo.find(
			(row) => row.user_id === sender.id && row.friend_id === receiver.id,
		);
		assert.equal(json.streak, 4);
		assert.equal(lastOyInfo?.streak_start_date, streakStartDate);
	});

	it("keeps streak same when sending oy on same day", async () => {
		const { env, db } = createTestEnv();
		const sender = seedUser(db, { username: "Sender" });
		const receiver = seedUser(db, { username: "Receiver" });
		seedSession(db, sender.id, "streak-same-token");
		const { startOfTodayNY } = getStreakDateBoundaries();
		const streakStartDate = startOfTodayNY - 4 * 24 * 60 * 60;
		const lastOyCreatedAt = startOfTodayNY + 60;
		seedFriendship(db, sender.id, receiver.id);
		seedFriendship(db, receiver.id, sender.id);
		seedLastOyInfo(db, {
			userId: sender.id,
			friendId: receiver.id,
			lastOyCreatedAt,
			streakStartDate,
		});
		const { res, json } = await jsonRequest(env, "/api/oy", {
			method: "POST",
			headers: { "x-session-token": "streak-same-token" },
			body: { toUserId: receiver.id },
		});
		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		const lastOyInfo = db.lastOyInfo.find(
			(row) => row.user_id === sender.id && row.friend_id === receiver.id,
		);
		assert.equal(json.streak, 5);
		assert.equal(lastOyInfo?.streak_start_date, streakStartDate);
	});

	it("resets streak to 1 when sending oy after gap", async () => {
		const { env, db } = createTestEnv();
		const sender = seedUser(db, { username: "Sender" });
		const receiver = seedUser(db, { username: "Receiver" });
		seedSession(db, sender.id, "streak-reset-token");
		const { startOfTodayNY } = getStreakDateBoundaries();
		const lastOyCreatedAt = startOfTodayNY - 3 * 24 * 60 * 60;
		const streakStartDate = startOfTodayNY - 10 * 24 * 60 * 60;
		seedFriendship(db, sender.id, receiver.id);
		seedFriendship(db, receiver.id, sender.id);
		seedLastOyInfo(db, {
			userId: sender.id,
			friendId: receiver.id,
			lastOyCreatedAt,
			streakStartDate,
		});
		const { res, json } = await jsonRequest(env, "/api/oy", {
			method: "POST",
			headers: { "x-session-token": "streak-reset-token" },
			body: { toUserId: receiver.id },
		});
		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		const lastOyInfo = db.lastOyInfo.find(
			(row) => row.user_id === sender.id && row.friend_id === receiver.id,
		);
		assert.equal(json.streak, 1);
		assert.equal(lastOyInfo?.streak_start_date, startOfTodayNY);
	});

	it("creates location payloads and notification URLs for los", async () => {
		const { env, db } = createTestEnv();
		const sender = seedUser(db, { username: "Locator" });
		const receiver = seedUser(db, { username: "Tracker" });
		seedSession(db, sender.id, "lo-token");
		seedFriendship(db, sender.id, receiver.id);
		seedFriendship(db, receiver.id, sender.id);
		const { res, json } = await jsonRequest(env, "/api/lo", {
			method: "POST",
			headers: { "x-session-token": "lo-token" },
			body: { toUserId: receiver.id, location: { lat: 12.3, lon: 45.6 } },
		});
		assert.equal(res.status, 200);
		assert.equal(json.success, true);
		const notificationPayload = JSON.parse(db.notifications[0].payload);
		assert.ok(notificationPayload.url.includes("expand=location"));
		assert.equal(notificationPayload.fromUserId, sender.id);
		assert.ok(Number.isFinite(notificationPayload.createdAt));
	});

	it("returns counterpart nickname on oys list", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Sender" });
		const friend = seedUser(db, { username: "Receiver" });
		seedSession(db, user.id, "oys-nickname-token");
		seedFriendship(db, user.id, friend.id, { nickname: "Bestie" });
		seedFriendship(db, friend.id, user.id);
		seedOy(db, {
			fromUserId: user.id,
			toUserId: friend.id,
			type: "oy",
		});

		const { res, json } = await jsonRequest(env, "/api/oys", {
			headers: { "x-session-token": "oys-nickname-token" },
		});
		const body = json as {
			oys: Array<{ counterpart_nickname: string | null }>;
		};

		assert.equal(res.status, 200);
		assert.equal(body.oys.length, 1);
		assert.equal(body.oys[0].counterpart_nickname, "Bestie");
	});

	it("uses custom sound and channel for Android native push", async () => {
		const { env, db } = createTestEnv();
		const sender = seedUser(db, { username: "AndroidSender" });
		const receiver = seedUser(db, { username: "AndroidReceiver" });
		seedSession(db, sender.id, "android-oy-token");
		seedSession(db, receiver.id, "android-receiver-token");
		seedFriendship(db, sender.id, receiver.id);
		seedFriendship(db, receiver.id, sender.id);
		env.FCM_PROJECT_ID = "test-project";
		env.FCM_CLIENT_EMAIL = "test@example.com";
		env.FCM_PRIVATE_KEY = await createRsaPrivateKeyPem();

		await jsonRequest(env, "/api/push/native/subscribe", {
			method: "POST",
			headers: { "x-session-token": "android-receiver-token" },
			body: {
				token: "android-device-token",
				platform: "android",
			},
		});

		let fcmSendBody: Record<string, unknown> | null = null;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (input, init) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url === "https://oauth2.googleapis.com/token") {
				return Response.json({
					access_token: "fcm-access-token",
					expires_in: 3600,
				});
			}
			if (
				url ===
				"https://fcm.googleapis.com/v1/projects/test-project/messages:send"
			) {
				fcmSendBody = JSON.parse(String(init?.body ?? "{}")) as Record<
					string,
					unknown
				>;
				return Response.json({});
			}
			return new Response("unexpected fetch", { status: 500 });
		};

		try {
			const { res, json } = await jsonRequest(env, "/api/oy", {
				method: "POST",
				headers: { "x-session-token": "android-oy-token" },
				body: { toUserId: receiver.id },
			});

			assert.equal(res.status, 200);
			assert.equal(json.success, true);
			assert.ok(fcmSendBody);
			const message = (fcmSendBody?.message ?? {}) as {
				android?: { notification?: { channel_id?: string; sound?: string } };
			};
			assert.equal(
				message.android?.notification?.channel_id,
				"oy_notifications_v1",
			);
			assert.equal(message.android?.notification?.sound, "oy");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("uses custom sound for iOS native push", async () => {
		const { env, db } = createTestEnv();
		const sender = seedUser(db, { username: "IosSender" });
		const receiver = seedUser(db, { username: "IosReceiver" });
		seedSession(db, sender.id, "ios-oy-token");
		seedSession(db, receiver.id, "ios-receiver-token");
		seedFriendship(db, sender.id, receiver.id);
		seedFriendship(db, receiver.id, sender.id);
		env.APPLE_PRIVATE_KEY = await createEcPrivateKeyPem();

		await jsonRequest(env, "/api/push/native/subscribe", {
			method: "POST",
			headers: { "x-session-token": "ios-receiver-token" },
			body: {
				token: "ios-device-token",
				platform: "ios",
				apnsEnvironment: "sandbox",
			},
		});

		let apnsPayload: Record<string, unknown> | null = null;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (input, init) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url === "https://api.sandbox.push.apple.com/3/device/ios-device-token") {
				apnsPayload = JSON.parse(String(init?.body ?? "{}")) as Record<
					string,
					unknown
				>;
				return Response.json({});
			}
			return new Response("unexpected fetch", { status: 500 });
		};

		try {
			const { res, json } = await jsonRequest(env, "/api/oy", {
				method: "POST",
				headers: { "x-session-token": "ios-oy-token" },
				body: { toUserId: receiver.id },
			});

			assert.equal(res.status, 200);
			assert.equal(json.success, true);
			assert.ok(apnsPayload);
			const aps = (apnsPayload?.aps ?? {}) as { sound?: string };
			assert.equal(aps.sound, "oy.wav");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("returns recent oys ordered and supports cursors", async () => {
		const { env, db } = createTestEnv();
		const user = seedUser(db, { username: "Viewer" });
		const other = seedUser(db, { username: "Other" });
		seedSession(db, user.id, "oys-token");
		seedOy(db, {
			fromUserId: other.id,
			toUserId: user.id,
			type: "oy",
			createdAt: 100,
		});
		seedOy(db, {
			fromUserId: user.id,
			toUserId: other.id,
			type: "oy",
			createdAt: 120,
		});
		seedOy(db, {
			fromUserId: other.id,
			toUserId: user.id,
			type: "oy",
			createdAt: 110,
		});
		const { res, json } = await jsonRequest(env, "/api/oys", {
			headers: { "x-session-token": "oys-token" },
		});
		const body = json as {
			oys: Array<{ created_at: number }>;
			nextCursor: unknown;
		};
		assert.equal(res.status, 200);
		assert.equal(body.oys.length, 3);
		assert.equal(body.oys[0].created_at, 120);
		assert.equal(body.nextCursor, null);

		for (let i = 0; i < 31; i += 1) {
			seedOy(db, {
				fromUserId: other.id,
				toUserId: user.id,
				type: "oy",
				createdAt: 200 + i,
			});
		}
		const { json: paged } = await jsonRequest(env, "/api/oys", {
			headers: { "x-session-token": "oys-token" },
		});
		const pagedBody = paged as {
			oys: Array<unknown>;
			nextCursor: unknown;
		};
		assert.equal(pagedBody.oys.length, 30);
		assert.ok(pagedBody.nextCursor);
	});

	it("excludes oys between blocked users from fetch results", async () => {
		const { env, db } = createTestEnv();
		const me = seedUser(db, { username: "Viewer" });
		const other = seedUser(db, { username: "BlockedUser" });
		seedSession(db, me.id, "oys-block-token");

		seedOy(db, {
			fromUserId: other.id,
			toUserId: me.id,
			type: "oy",
			createdAt: 200,
		});
		seedOy(db, {
			fromUserId: me.id,
			toUserId: other.id,
			type: "oy",
			createdAt: 210,
		});

		await jsonRequest(env, `/api/friends/${other.id}/block`, {
			method: "POST",
			headers: { "x-session-token": "oys-block-token" },
		});

		const { res, json } = await jsonRequest(env, "/api/oys", {
			headers: { "x-session-token": "oys-block-token" },
		});
		const body = json as { oys: Array<unknown> };
		assert.equal(res.status, 200);
		assert.equal(body.oys.length, 0);
	});
});
