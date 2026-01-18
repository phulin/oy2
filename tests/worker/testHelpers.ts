import type { TestContext } from "node:test";
import app from "../../worker/index";
import { createExecutionContext, createTestEnv } from "./testUtils";

type RequestOptions = {
	method?: string;
	body?: Record<string, unknown>;
	headers?: Record<string, string>;
};

export const jsonRequest = async (
	env: ReturnType<typeof createTestEnv>["env"],
	path: string,
	{ method = "GET", body, headers = {} }: RequestOptions = {},
) => {
	const requestInit: RequestInit = {
		method,
		headers,
	};
	if (body) {
		requestInit.body = JSON.stringify(body);
		requestInit.headers = {
			...headers,
			"content-type": "application/json",
		};
	}
	const req = new Request(`http://localhost${path}`, requestInit);
	const ctx = createExecutionContext();
	const res = await app.request(
		req,
		undefined,
		env as Parameters<typeof app.request>[2],
		ctx,
	);
	const json = (await res.json()) as Record<string, unknown>;
	await Promise.all(ctx.waitUntilPromises);
	return { res, json };
};

export const setOtpFetchMock = (
	t: TestContext,
	{
		generate = { success: true, quotaRemaining: 1, otp: "123456" },
		verify = { success: true, isValidOtp: true },
	}: {
		generate?: { success: boolean; quotaRemaining: number; otp: string };
		verify?: { success: boolean; isValidOtp: boolean };
	} = {},
) => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input) => {
		let url: string;
		if (typeof input === "string") {
			url = input;
		} else if (input instanceof URL) {
			url = input.toString();
		} else {
			url = input.url;
		}
		if (url.includes("/otp/generate")) {
			return {
				ok: true,
				json: async () => generate,
			} as Response;
		}
		if (url.includes("/otp/verify")) {
			return {
				ok: true,
				json: async () => verify,
			} as Response;
		}
		throw new Error(`Unexpected fetch: ${url}`);
	};
	t.after(() => {
		globalThis.fetch = originalFetch;
	});
};
