import { registerSW } from "virtual:pwa-register";
import { useNavigate } from "@solidjs/router";
import type { JSX } from "solid-js";
import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { AppContext } from "./AppContext";
import { ChooseUsernameScreen } from "./components/ChooseUsernameScreen";
import { EmailLoginScreen } from "./components/EmailLoginScreen";
import { LoginScreen } from "./components/LoginScreen";
import { addOyToast, OyToastContainer } from "./components/OyToast";
import { PasskeySetupScreen } from "./components/PasskeySetupScreen";
import type {
	Friend,
	FriendWithLastOy,
	LastOyInfo,
	Oy,
	OysCursor,
	User,
} from "./types";
import { urlBase64ToUint8Array } from "./utils";
import "./App.css";

const urlParams = new URLSearchParams(window.location.search);
const hashValue = window.location.hash.replace(/^#/, "");
const hashParams = new URLSearchParams(hashValue);
const requestedTab =
	hashValue && hashValue !== "tab"
		? (hashParams.get("tab") ?? hashValue)
		: urlParams.get("tab");
const requestedOyId = urlParams.get("oy") ?? hashParams.get("oy");
const requestedExpand = urlParams.get("expand") ?? hashParams.get("expand");
const initialTab =
	requestedTab && ["friends", "oys", "add"].includes(requestedTab)
		? requestedTab
		: "friends";
const cachedUserStorageKey = "cachedUser";
const cachedFriendsStorageKey = "cachedFriends";
const cachedLastOyInfoStorageKey = "cachedLastOyInfo";
const passkeySetupSkipStorageKey = "passkeySetupSkipped";

type AuthStep =
	| "initial"
	| "login"
	| "email_login"
	| "choose_username"
	| "passkey_setup";

// Check URL params for OAuth callback state
const needsChooseUsername = urlParams.get("choose_username") === "1";
const needsPasskeySetup = urlParams.get("passkey_setup") === "1";

// Clear URL params after reading
if (needsChooseUsername || needsPasskeySetup) {
	const cleanUrl = window.location.pathname + window.location.hash;
	history.replaceState(null, "", cleanUrl);
}

type AppProps = {
	children?: JSX.Element;
};

export default function App(props: AppProps) {
	const navigate = useNavigate();

	const cachedUserRaw = localStorage.getItem(cachedUserStorageKey);
	const cachedFriendsRaw = localStorage.getItem(cachedFriendsStorageKey);
	const cachedLastOyInfoRaw = localStorage.getItem(cachedLastOyInfoStorageKey);
	const initialCachedUser = cachedUserRaw
		? (JSON.parse(cachedUserRaw) as User)
		: null;
	const initialCachedFriends = cachedFriendsRaw
		? (JSON.parse(cachedFriendsRaw) as Friend[])
		: [];
	const initialCachedLastOyInfo = cachedLastOyInfoRaw
		? (JSON.parse(cachedLastOyInfoRaw) as LastOyInfo[])
		: [];

	const [booting, setBooting] = createSignal(true);
	const [currentUser, setCurrentUser] = createSignal<User | null>(
		initialCachedUser,
	);
	// Determine initial auth step based on URL params
	const initialAuthStep: AuthStep = needsChooseUsername
		? "choose_username"
		: needsPasskeySetup
			? "passkey_setup"
			: "initial";
	const [authStep, setAuthStep] = createSignal<AuthStep>(initialAuthStep);
	const [friends, setFriends] = createSignal<Friend[]>(initialCachedFriends);
	const [lastOyInfo, setLastOyInfo] = createSignal<LastOyInfo[]>(
		initialCachedLastOyInfo,
	);
	const [oys, setOys] = createSignal<Oy[]>([]);
	const [tab, setTab] = createSignal(initialTab);
	const [openLocations, setOpenLocations] = createSignal<Set<number>>(
		new Set(),
	);
	const [swRegistration, setSwRegistration] =
		createSignal<ServiceWorkerRegistration | null>(null);
	const parsedOyId = requestedOyId ? Number(requestedOyId) : null;
	const [loadingOys, setLoadingOys] = createSignal(false);
	const [loadingMoreOys, setLoadingMoreOys] = createSignal(false);
	const [loadingFriends, setLoadingFriends] = createSignal(false);
	const [loadingLastOyInfo, setLoadingLastOyInfo] = createSignal(false);
	const [hasMoreOys, setHasMoreOys] = createSignal(true);
	const [oysCursor, setOysCursor] = createSignal<OysCursor | null>(null);
	let pendingExpandOyId: number | null =
		parsedOyId !== null && Number.isFinite(parsedOyId) ? parsedOyId : null;
	let pendingExpandType: string | null = requestedExpand;
	const seenNotificationLimit = 100;

	const friendsWithLastOy = createMemo<FriendWithLastOy[]>(() => {
		const infoByFriendId = new Map(
			lastOyInfo().map((info) => [info.friend_id, info]),
		);
		return friends().map((friend) => {
			const info = infoByFriendId.get(friend.id);
			return {
				...friend,
				last_oy_type: info?.last_oy_type ?? null,
				last_oy_created_at: info?.last_oy_created_at ?? null,
				last_oy_from_user_id: info?.last_oy_from_user_id ?? null,
				streak: info?.streak ?? 0,
			};
		});
	});

	async function api<T>(
		endpoint: string,
		options: RequestInit = {},
	): Promise<T> {
		const headers = new Headers(options.headers || {});
		headers.set("Content-Type", "application/json");

		const response = await fetch(endpoint, {
			...options,
			headers,
			credentials: "include",
		});
		if (!response.ok) {
			const error = await response
				.json()
				.catch(() => ({ error: "Request failed" }));
			throw new Error(error.error || "Request failed");
		}
		return response.json() as Promise<T>;
	}

	async function ensurePushSubscription(
		registration: ServiceWorkerRegistration,
	) {
		if (!("Notification" in window && "PushManager" in window)) {
			return;
		}

		let permission = Notification.permission;
		if (permission === "denied") {
			return;
		}

		if (permission !== "granted") {
			permission = await Notification.requestPermission();
		}

		if (permission !== "granted") {
			return;
		}

		let subscription = await registration.pushManager.getSubscription();

		if (!subscription) {
			const { publicKey } = await api<{ publicKey: string }>(
				"/api/push/vapid-public-key",
			);
			subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(publicKey),
			});
		}

		await api("/api/push/subscribe", {
			method: "POST",
			body: JSON.stringify(subscription.toJSON()),
		});
	}

	async function registerServiceWorker() {
		if (!("serviceWorker" in navigator)) {
			return;
		}

		const updateSW = registerSW({
			immediate: true,
			onNeedRefresh() {
				void updateSW(true);
			},
		});

		// Reload page when new SW takes control to ensure code consistency
		navigator.serviceWorker.addEventListener("controllerchange", () => {
			window.location.reload();
		});

		navigator.serviceWorker.ready
			.then((registration) => {
				setSwRegistration(registration);

				const refreshRegistration = () => {
					if (document.visibilityState === "visible") {
						void registration.update();
					}
				};

				refreshRegistration();
				document.addEventListener("visibilitychange", refreshRegistration);
				onCleanup(() => {
					document.removeEventListener("visibilitychange", refreshRegistration);
				});
			})
			.catch((err) => {
				console.error("Service worker ready failed:", err);
			});
	}

	async function loadFriends() {
		setLoadingFriends(true);
		try {
			const { friends: data } = await api<{ friends: Friend[] }>(
				"/api/friends",
			);
			const nextFriends = data || [];
			setFriends(nextFriends);
			localStorage.setItem(
				cachedFriendsStorageKey,
				JSON.stringify(nextFriends),
			);
		} catch (err) {
			console.error("Failed to load friends:", err);
		} finally {
			setLoadingFriends(false);
		}
	}

	function handleFriendAdded(friend: Friend) {
		setFriends((prev) => {
			if (prev.some((existing) => existing.id === friend.id)) {
				return prev;
			}
			const nextFriends = [...prev, friend].sort((a, b) =>
				a.username.localeCompare(b.username),
			);
			localStorage.setItem(
				cachedFriendsStorageKey,
				JSON.stringify(nextFriends),
			);
			return nextFriends;
		});
	}

	async function loadLastOyInfo() {
		setLoadingLastOyInfo(true);
		try {
			const { lastOyInfo: data } = await api<{ lastOyInfo: LastOyInfo[] }>(
				"/api/last-oy-info",
			);
			const nextLastOyInfo = data || [];
			setLastOyInfo(nextLastOyInfo);
			localStorage.setItem(
				cachedLastOyInfoStorageKey,
				JSON.stringify(nextLastOyInfo),
			);
		} catch (err) {
			console.error("Failed to load last oy info:", err);
		} finally {
			setLoadingLastOyInfo(false);
		}
	}

	async function loadOysPage({ reset = false }: { reset?: boolean } = {}) {
		if (!reset && (loadingMoreOys() || !hasMoreOys())) {
			return;
		}
		if (reset) {
			setLoadingOys(true);
		} else {
			setLoadingMoreOys(true);
		}

		try {
			const cursor = reset ? null : oysCursor();
			const query = cursor
				? `?before=${cursor.before}&beforeId=${cursor.beforeId}`
				: "";
			const { oys: oysData, nextCursor } = await api<{
				oys: Oy[];
				nextCursor: OysCursor | null;
			}>(`/api/oys${query}`);
			setOys((prev) => (reset ? oysData : [...prev, ...oysData]));
			setOysCursor(nextCursor);
			setHasMoreOys(!!nextCursor);
		} catch (err) {
			console.error("Failed to load oys:", err);
		} finally {
			if (reset) {
				setLoadingOys(false);
			} else {
				setLoadingMoreOys(false);
			}
		}

		if (reset) {
			setOpenLocations(new Set<number>());
			const expandId = pendingExpandOyId;
			if (expandId !== null && pendingExpandType === "location") {
				setOpenLocations(new Set([expandId]));
				pendingExpandOyId = null;
				pendingExpandType = null;
			}
		}
	}

	async function loadData() {
		await Promise.all([
			loadFriends(),
			loadLastOyInfo(),
			loadOysPage({ reset: true }),
		]);
	}

	async function applyAuthSession(user: User) {
		localStorage.setItem(cachedUserStorageKey, JSON.stringify(user));
		setCurrentUser(user);
		await loadData();
	}

	// Handle OAuth username selection completion
	async function handleUsernameComplete(
		user: User,
		needsPasskeySetup: boolean,
	) {
		await applyAuthSession(user);
		setAuthStep(needsPasskeySetup ? "passkey_setup" : "login");
	}

	// Handle passkey setup completion
	function handlePasskeyComplete() {
		localStorage.removeItem(passkeySetupSkipStorageKey);
		setAuthStep("login"); // Will show main app since user is logged in
	}

	// Handle passkey setup skip
	function handlePasskeySkip() {
		localStorage.setItem(passkeySetupSkipStorageKey, "1");
		setAuthStep("login"); // Will show main app since user is logged in
	}

	function passkeyAddComplete() {
		handlePasskeyComplete();
		navigate("/settings");
	}

	function passkeyAddCancel() {
		navigate("/settings");
	}

	// Try zero-click passkey authentication
	async function tryPasskeyAuth(): Promise<boolean> {
		if (!window.PublicKeyCredential) {
			return false;
		}

		try {
			// Check if conditional mediation is available
			const available =
				await PublicKeyCredential.isConditionalMediationAvailable?.();
			if (!available) {
				return false;
			}

			// Get authentication options
			const optionsResponse = await fetch("/api/auth/passkey/auth/options", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
			});

			if (!optionsResponse.ok) {
				return false;
			}

			const options = (await optionsResponse.json()) as {
				authId: string;
				challenge: string;
				rpId: string;
				timeout: number;
				userVerification: UserVerificationRequirement;
			};

			// Try to get credential with conditional mediation
			const credential = (await navigator.credentials.get({
				publicKey: {
					challenge: base64UrlDecode(options.challenge).buffer as ArrayBuffer,
					rpId: options.rpId,
					timeout: options.timeout,
					userVerification: options.userVerification,
					allowCredentials: [],
				},
				mediation: "conditional",
			})) as PublicKeyCredential | null;

			if (!credential) {
				return false;
			}

			const response = credential.response as AuthenticatorAssertionResponse;

			// Verify with server
			const verifyResponse = await fetch("/api/auth/passkey/auth/verify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					authId: options.authId,
					credential: {
						id: credential.id,
						rawId: base64UrlEncode(credential.rawId),
						type: credential.type,
						response: {
							clientDataJSON: base64UrlEncode(response.clientDataJSON),
							authenticatorData: base64UrlEncode(response.authenticatorData),
							signature: base64UrlEncode(response.signature),
							userHandle: response.userHandle
								? base64UrlEncode(response.userHandle)
								: null,
						},
					},
				}),
			});

			if (!verifyResponse.ok) {
				return false;
			}

			const { user } = (await verifyResponse.json()) as { user: User };
			await applyAuthSession(user);
			return true;
		} catch {
			return false;
		}
	}

	async function handleEmailLoginSuccess(
		result:
			| { status: "choose_username" }
			| {
					status: "authenticated";
					user: { id: number; username: string };
					needsPasskeySetup: boolean;
			  },
	) {
		if (result.status === "choose_username") {
			setAuthStep("choose_username");
			return;
		}

		await applyAuthSession(result.user);
		setAuthStep(result.needsPasskeySetup ? "passkey_setup" : "login");
	}

	function base64UrlEncode(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let binary = "";
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary)
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
	}

	function base64UrlDecode(str: string): Uint8Array {
		const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
		const padding = "=".repeat((4 - (base64.length % 4)) % 4);
		const binary = atob(base64 + padding);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}

	async function restoreSession() {
		try {
			const { user } = await api<{ user: User }>("/api/auth/session");
			setCurrentUser(user);
			localStorage.setItem(cachedUserStorageKey, JSON.stringify(user));
			await loadData();
		} catch (_err) {
			setCurrentUser(null);
			localStorage.removeItem(cachedUserStorageKey);
			localStorage.removeItem(cachedFriendsStorageKey);
			localStorage.removeItem(cachedLastOyInfoStorageKey);
			if (authStep() === "initial") {
				setAuthStep("login");
			}
			setFriends([]);
			setLastOyInfo([]);
		}
	}

	async function maybePromptPasskeySetup() {
		if (authStep() !== "initial") {
			return;
		}
		if (localStorage.getItem(passkeySetupSkipStorageKey) === "1") {
			return;
		}
		const { hasPasskey } = await api<{ hasPasskey: boolean }>(
			"/api/auth/passkey/status",
		);
		if (!hasPasskey) {
			setAuthStep("passkey_setup");
		}
	}

	function logout() {
		api("/api/auth/logout", { method: "POST" }).catch((err) => {
			console.error("Logout failed:", err);
		});
		setCurrentUser(null);
		localStorage.removeItem(cachedUserStorageKey);
		localStorage.removeItem(cachedFriendsStorageKey);
		localStorage.removeItem(cachedLastOyInfoStorageKey);
		setAuthStep("login");
		setFriends([]);
		setLastOyInfo([]);

		const registration = swRegistration();
		if (registration) {
			unsubscribePush(registration).catch((err) => {
				console.error("Push unsubscribe failed:", err);
			});
		}
	}

	function handleSetupNotifications() {
		const registration = swRegistration();
		if (registration) {
			ensurePushSubscription(registration).catch((err) => {
				console.error("Notification setup failed:", err);
				alert("Failed to enable notifications. Please try again.");
			});
		} else {
			alert("Service worker not ready. Please refresh the page and try again.");
		}
	}

	async function unsubscribePush(registration: ServiceWorkerRegistration) {
		const subscription = await registration.pushManager.getSubscription();
		if (!subscription) {
			return;
		}

		await api("/api/push/unsubscribe", {
			method: "POST",
			body: JSON.stringify({ endpoint: subscription.endpoint }),
		});
	}

	async function sendOy(toUserId: number) {
		try {
			const { streak } = await api<{ streak: number }>("/api/oy", {
				method: "POST",
				body: JSON.stringify({ toUserId }),
			});
			const user = currentUser() as User;
			const now = Date.now();
			setLastOyInfo((prev) => {
				const existing = prev.find((info) => info.friend_id === toUserId);
				const nextInfo = existing
					? prev.map((info) =>
							info.friend_id === toUserId
								? {
										...info,
										last_oy_type: "oy",
										last_oy_created_at: now,
										last_oy_from_user_id: user.id,
										streak,
									}
								: info,
						)
					: [
							...prev,
							{
								friend_id: toUserId,
								last_oy_type: "oy",
								last_oy_created_at: now,
								last_oy_from_user_id: user.id,
								streak,
							},
						];
				localStorage.setItem(
					cachedLastOyInfoStorageKey,
					JSON.stringify(nextInfo),
				);
				return nextInfo;
			});
		} catch (err) {
			alert((err as Error).message);
		}
	}

	function getCurrentPosition(options?: PositionOptions) {
		return new Promise<GeolocationPosition>((resolve, reject) => {
			if (!navigator.geolocation) {
				reject(new Error("Geolocation not supported"));
				return;
			}
			navigator.geolocation.getCurrentPosition(resolve, reject, options);
		});
	}

	async function sendLo(toUserId: number) {
		try {
			const position = await getCurrentPosition({
				enableHighAccuracy: true,
				timeout: 10000,
				maximumAge: 0,
			});

			const location = {
				lat: position.coords.latitude,
				lon: position.coords.longitude,
				accuracy: position.coords.accuracy,
			};

			const { streak } = await api<{ streak: number }>("/api/lo", {
				method: "POST",
				body: JSON.stringify({ toUserId, location }),
			});
			const user = currentUser() as User;
			const now = Date.now();
			setLastOyInfo((prev) => {
				const existing = prev.find((info) => info.friend_id === toUserId);
				const nextInfo = existing
					? prev.map((info) =>
							info.friend_id === toUserId
								? {
										...info,
										last_oy_type: "lo",
										last_oy_created_at: now,
										last_oy_from_user_id: user.id,
										streak,
									}
								: info,
						)
					: [
							...prev,
							{
								friend_id: toUserId,
								last_oy_type: "lo",
								last_oy_created_at: now,
								last_oy_from_user_id: user.id,
								streak,
							},
						];
				localStorage.setItem(
					cachedLastOyInfoStorageKey,
					JSON.stringify(nextInfo),
				);
				return nextInfo;
			});
		} catch (err) {
			alert((err as Error).message);
		}
	}

	function toggleLocation(id: number) {
		setOpenLocations((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	}

	onMount(async () => {
		await registerServiceWorker();
		setLoadingFriends(true);
		setBooting(false);

		// If we need to choose username or set up passkey, don't try session restore
		if (authStep() === "choose_username" || authStep() === "passkey_setup") {
			// For passkey_setup, we need to restore session first
			if (authStep() === "passkey_setup") {
				await restoreSession();
			}
			setLoadingFriends(false);
			return;
		}

		// Try to restore existing session first
		await restoreSession();

		if (currentUser() && authStep() === "initial") {
			await maybePromptPasskeySetup();
			if (authStep() === "passkey_setup") {
				setLoadingFriends(false);
				return;
			}
		}

		// If no session and in initial state, try zero-click passkey
		if (!currentUser() && authStep() === "initial") {
			const passkeySuccess = await tryPasskeyAuth();
			if (!passkeySuccess) {
				setAuthStep("login");
			}
		}

		if (!currentUser()) {
			setLoadingFriends(false);
		}
	});

	onMount(() => {
		if (!("serviceWorker" in navigator)) {
			return;
		}

		const oyAudio = new Audio("/oy.wav");
		oyAudio.preload = "auto";
		let audioUnlocked = false;
		let waitingForGesture = false;
		let gestureHandler: (() => void) | null = null;

		const removeGestureListeners = () => {
			if (!gestureHandler) {
				return;
			}
			document.removeEventListener("click", gestureHandler);
			document.removeEventListener("touchstart", gestureHandler);
			document.removeEventListener("keydown", gestureHandler);
			gestureHandler = null;
		};

		const ensureAudioUnlocked = () => {
			if (audioUnlocked || waitingForGesture) {
				return;
			}
			waitingForGesture = true;
			gestureHandler = () => {
				removeGestureListeners();
				waitingForGesture = false;
				void oyAudio
					.play()
					.then(() => {
						oyAudio.pause();
						oyAudio.currentTime = 0;
						audioUnlocked = true;
					})
					.catch(() => {});
			};
			document.addEventListener("click", gestureHandler);
			document.addEventListener("touchstart", gestureHandler);
			document.addEventListener("keydown", gestureHandler);
		};
		const seenNotificationIdsRaw = localStorage.getItem("seenNotificationIds");
		const seenNotificationIds = seenNotificationIdsRaw
			? (JSON.parse(seenNotificationIdsRaw) as number[])
			: [];
		const seenNotificationSet = new Set(seenNotificationIds);

		const rememberNotification = (notificationId: number) => {
			if (seenNotificationSet.has(notificationId)) {
				return false;
			}
			seenNotificationSet.add(notificationId);
			seenNotificationIds.push(notificationId);
			if (seenNotificationIds.length > seenNotificationLimit) {
				seenNotificationIds.splice(
					0,
					seenNotificationIds.length - seenNotificationLimit,
				);
			}
			localStorage.setItem(
				"seenNotificationIds",
				JSON.stringify(seenNotificationIds),
			);
			return true;
		};

		const onMessage = (event: MessageEvent) => {
			const payload = event.data?.payload as
				| {
						type?: string;
						notificationId?: number;
						title?: string;
						body?: string;
						createdAt?: number;
						fromUserId?: number;
				  }
				| undefined;
			if (payload?.type !== "oy" && payload?.type !== "lo") {
				return;
			}
			if (
				payload.notificationId &&
				!rememberNotification(payload.notificationId)
			) {
				return;
			}
			const createdAt = payload.createdAt;
			const fromUserId = payload.fromUserId;
			if (
				currentUser() &&
				typeof fromUserId === "number" &&
				typeof createdAt === "number" &&
				Number.isFinite(createdAt)
			) {
				setLastOyInfo((prev) => {
					const next = prev.map((info) =>
						info.friend_id === fromUserId
							? {
									...info,
									last_oy_type: payload.type ?? null,
									last_oy_created_at: createdAt,
									last_oy_from_user_id: fromUserId,
								}
							: info,
					);
					const hasExisting = next.some(
						(info) => info.friend_id === fromUserId,
					);
					const nextList = hasExisting
						? next
						: [
								...next,
								{
									friend_id: fromUserId,
									last_oy_type: payload.type ?? null,
									last_oy_created_at: createdAt,
									last_oy_from_user_id: fromUserId,
									streak: 0,
								},
							];
					const sorted = [...nextList].sort(
						(a, b) =>
							(b.last_oy_created_at ?? -1) - (a.last_oy_created_at ?? -1),
					);
					localStorage.setItem(
						cachedLastOyInfoStorageKey,
						JSON.stringify(sorted),
					);
					return sorted;
				});
			}
			void oyAudio.play().catch(() => {
				ensureAudioUnlocked();
			});

			// Show toast notification for oys only
			if (
				payload.type === "oy" &&
				payload.notificationId &&
				payload.title &&
				payload.body &&
				currentUser()
			) {
				addOyToast({
					id: payload.notificationId,
					title: payload.title,
					body: payload.body,
				});
			}
		};

		navigator.serviceWorker.addEventListener("message", onMessage);
		onCleanup(() => {
			navigator.serviceWorker.removeEventListener("message", onMessage);
			removeGestureListeners();
		});
	});

	createEffect(() => {
		const registration = swRegistration();
		if (registration && currentUser()) {
			ensurePushSubscription(registration).catch((err) => {
				console.error("Push subscription refresh failed:", err);
			});
		}
	});

	createEffect(() => {
		if (tab() === "oys" && currentUser()) {
			loadOysPage({ reset: true });
		}
	});

	const appContextValue = {
		currentUser,
		friends,
		friendsWithLastOy,
		lastOyInfo,
		oys,
		openLocations,
		loadingFriends,
		loadingLastOyInfo,
		loadingOys,
		loadingMoreOys,
		hasMoreOys,
		tab,
		setTab,
		api,
		logout,
		handleSetupNotifications,
		sendOy,
		sendLo,
		toggleLocation,
		loadOysPage,
		handleFriendAdded,
		passkeyAddComplete,
		passkeyAddCancel,
	};

	return (
		<>
			<OyToastContainer />
			<Show when={!booting()}>
				<Show when={authStep() === "choose_username"}>
					<ChooseUsernameScreen onComplete={handleUsernameComplete} />
				</Show>
				<Show when={authStep() === "passkey_setup" && currentUser()}>
					<PasskeySetupScreen
						onComplete={handlePasskeyComplete}
						onSkip={handlePasskeySkip}
					/>
				</Show>
				<Show
					when={
						authStep() !== "choose_username" && authStep() !== "passkey_setup"
					}
				>
					<Show
						when={currentUser()}
						fallback={
							<>
								<Show when={authStep() === "login"}>
									<LoginScreen
										onTryPasskey={async () => {
											if (currentUser()) {
												return;
											}
											await tryPasskeyAuth();
										}}
										onEmailLogin={() => setAuthStep("email_login")}
									/>
								</Show>
								<Show when={authStep() === "email_login"}>
									<EmailLoginScreen
										onSuccess={handleEmailLoginSuccess}
										onBack={() => setAuthStep("login")}
									/>
								</Show>
							</>
						}
					>
						<AppContext.Provider value={appContextValue}>
							{props.children}
						</AppContext.Provider>
					</Show>
				</Show>
			</Show>
		</>
	);
}
