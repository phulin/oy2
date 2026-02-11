import { Capacitor } from "@capacitor/core";

type PasskeyFlow = "login" | "register" | "autofill";

type PasskeyErrorLike = Error & {
	code?: number | string;
};

function environmentSnapshot() {
	return {
		origin: window.location.origin,
		href: window.location.href,
		hostname: window.location.hostname,
		isSecureContext: window.isSecureContext,
		visibilityState: document.visibilityState,
		hasPublicKeyCredential: !!window.PublicKeyCredential,
		isNative: Capacitor.isNativePlatform(),
		platform: Capacitor.getPlatform(),
	};
}

export function logPasskeyEvent(
	flow: PasskeyFlow,
	event: string,
	data?: unknown,
) {
	if (data === undefined) {
		console.log(`[passkey-debug] ${flow}.${event}`);
		return;
	}
	console.log(`[passkey-debug] ${flow}.${event}`, data);
}

export function logPasskeyStart(flow: PasskeyFlow): number {
	const startedAt = performance.now();
	logPasskeyEvent(flow, "start", environmentSnapshot());
	return startedAt;
}

export function logPasskeyError(
	flow: PasskeyFlow,
	startedAt: number,
	err: unknown,
) {
	const elapsedMs = Math.round(performance.now() - startedAt);
	const error = err as PasskeyErrorLike;
	logPasskeyEvent(flow, "error", {
		name: error?.name,
		message: error?.message,
		code: error?.code,
		elapsedMs,
		env: environmentSnapshot(),
	});
}
