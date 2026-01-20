import { registerSW } from "virtual:pwa-register";
import { Tabs } from "@kobalte/core";
import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { AddFriendForm } from "./components/AddFriendForm";
import { AdminDashboard } from "./components/AdminDashboard";
import { AppHeader } from "./components/AppHeader";
import { FriendsList } from "./components/FriendsList";
import { LoginScreen } from "./components/LoginScreen";
import { OysList } from "./components/OysList";
import { addOyToast, OyToastContainer } from "./components/OyToast";
import { PhoneVerificationScreen } from "./components/PhoneVerificationScreen";
import { PrivacyPolicyScreen } from "./components/PrivacyPolicyScreen";
import { Screen } from "./components/Screen";
import { SwipeableTabs } from "./components/SwipeableTabs";
import { VerifyCodeScreen } from "./components/VerifyCodeScreen";
import type {
	Friend,
	FriendWithLastYo,
	LastYoInfo,
	Oy,
	OysCursor,
	User,
} from "./types";
import { urlBase64ToUint8Array } from "./utils";
import "./App.css";

const urlParams = new URLSearchParams(window.location.search);
const hashValue = window.location.hash.replace(/^#/, "");
const hashParams = new URLSearchParams(hashValue);
const initialHashUsesParam = hashParams.has("tab");
const requestedTab =
	hashValue && hashValue !== "tab"
		? (hashParams.get("tab") ?? hashValue)
		: urlParams.get("tab");
const requestedOyId = urlParams.get("yo") ?? hashParams.get("yo");
const requestedExpand = urlParams.get("expand") ?? hashParams.get("expand");
const initialTab =
	requestedTab && ["friends", "oys", "add"].includes(requestedTab)
		? requestedTab
		: "friends";
const isAdminRoute = window.location.pathname === "/admin";
const isPrivacyRoute = window.location.pathname === "/privacy";
const cachedUserStorageKey = "cachedUser";
const cachedFriendsStorageKey = "cachedFriends";
const cachedLastYoInfoStorageKey = "cachedLastYoInfo";

type AuthStep = "login" | "phone" | "verify";

export default function App() {
	if (isPrivacyRoute) {
		return <PrivacyPolicyScreen />;
	}

	const cachedUserRaw = localStorage.getItem(cachedUserStorageKey);
	const cachedFriendsRaw = localStorage.getItem(cachedFriendsStorageKey);
	const cachedLastYoInfoRaw = localStorage.getItem(cachedLastYoInfoStorageKey);
	const initialSessionToken = localStorage.getItem("sessionToken");
	const initialCachedUser =
		initialSessionToken && cachedUserRaw
			? (JSON.parse(cachedUserRaw) as User)
			: null;
	const initialCachedFriends = cachedFriendsRaw
		? (JSON.parse(cachedFriendsRaw) as Friend[])
		: [];
	const initialCachedLastYoInfo = cachedLastYoInfoRaw
		? (JSON.parse(cachedLastYoInfoRaw) as LastYoInfo[])
		: [];

	const [booting, setBooting] = createSignal(true);
	const [currentUser, setCurrentUser] = createSignal<User | null>(
		initialCachedUser,
	);
	const [sessionToken, setSessionToken] = createSignal<string | null>(
		initialSessionToken,
	);
	const [authStep, setAuthStep] = createSignal<AuthStep>("login");
	const [pendingUsername, setPendingUsername] = createSignal<string>("");
	const [friends, setFriends] = createSignal<Friend[]>(initialCachedFriends);
	const [lastYoInfo, setLastYoInfo] = createSignal<LastYoInfo[]>(
		initialCachedLastYoInfo,
	);
	const [hasCachedFriends, setHasCachedFriends] = createSignal(
		cachedFriendsRaw !== null,
	);
	const [hasCachedLastYoInfo, setHasCachedLastYoInfo] = createSignal(
		cachedLastYoInfoRaw !== null,
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
	const [loadingLastYoInfo, setLoadingLastYoInfo] = createSignal(false);
	const [hasMoreOys, setHasMoreOys] = createSignal(true);
	const [oysCursor, setOysCursor] = createSignal<OysCursor | null>(null);
	let pendingExpandOyId: number | null =
		parsedOyId !== null && Number.isFinite(parsedOyId) ? parsedOyId : null;
	let pendingExpandType: string | null = requestedExpand;
	let hasUpdatedHash = false;
	const tabOrder = ["friends", "oys", "add"] as const;
	const seenNotificationLimit = 100;

	const friendsWithLastYo = createMemo<FriendWithLastYo[]>(() => {
		const infoByFriendId = new Map(
			lastYoInfo().map((info) => [info.friend_id, info]),
		);
		return friends().map((friend) => {
			const info = infoByFriendId.get(friend.id);
			return {
				...friend,
				last_yo_type: info?.last_yo_type ?? null,
				last_yo_created_at: info?.last_yo_created_at ?? null,
				last_yo_from_user_id: info?.last_yo_from_user_id ?? null,
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

		const token = sessionToken();
		if (token) {
			headers.set("X-Session-Token", token);
		}

		const response = await fetch(endpoint, { ...options, headers });
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
			setHasCachedFriends(true);
		} catch (err) {
			console.error("Failed to load friends:", err);
		} finally {
			setLoadingFriends(false);
		}
	}

	async function loadLastYoInfo() {
		setLoadingLastYoInfo(true);
		try {
			const { lastYoInfo: data } = await api<{ lastYoInfo: LastYoInfo[] }>(
				"/api/last-yo-info",
			);
			const nextLastYoInfo = data || [];
			setLastYoInfo(nextLastYoInfo);
			localStorage.setItem(
				cachedLastYoInfoStorageKey,
				JSON.stringify(nextLastYoInfo),
			);
			setHasCachedLastYoInfo(true);
		} catch (err) {
			console.error("Failed to load last yo info:", err);
		} finally {
			setLoadingLastYoInfo(false);
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
		await Promise.all([loadFriends(), loadOysPage({ reset: true })]);
	}

	async function applyAuthSession(user: User, token: string) {
		setSessionToken(token);
		localStorage.setItem("sessionToken", token);
		localStorage.setItem(cachedUserStorageKey, JSON.stringify(user));
		setCurrentUser(user);
		await loadData();
	}

	async function handleLogin(event: SubmitEvent) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const formData = new FormData(form);
		const username = String(formData.get("username") || "").trim();
		if (!username) {
			return;
		}
		try {
			const response = await api<
				| { status: "needs_phone" | "code_sent" }
				| { status: "authenticated"; user: User; token: string }
			>("/api/auth/start", {
				method: "POST",
				body: JSON.stringify({ username }),
			});
			setPendingUsername(username);
			if (response.status === "authenticated") {
				await applyAuthSession(response.user, response.token);
				return;
			}
			setAuthStep(response.status === "needs_phone" ? "phone" : "verify");
		} catch (err) {
			alert((err as Error).message);
		}
	}

	async function handlePhoneSubmit(event: SubmitEvent) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const formData = new FormData(form);
		const phone = String(formData.get("phone") || "").trim();
		if (!phone) {
			return;
		}
		try {
			const response = await api<{ status: "code_sent" }>("/api/auth/phone", {
				method: "POST",
				body: JSON.stringify({ username: pendingUsername(), phone }),
			});
			setAuthStep(response.status === "code_sent" ? "verify" : "phone");
		} catch (err) {
			alert((err as Error).message);
		}
	}

	async function handleVerifySubmit(event: SubmitEvent) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const formData = new FormData(form);
		const otp = String(formData.get("otp") || "").trim();
		if (!otp) {
			return;
		}
		try {
			const { user, token } = await api<{ user: User; token: string }>(
				"/api/auth/verify",
				{
					method: "POST",
					body: JSON.stringify({ username: pendingUsername(), otp }),
				},
			);
			await applyAuthSession(user, token);
		} catch (err) {
			alert((err as Error).message);
		}
	}

	async function restoreSession(token: string) {
		try {
			setSessionToken(token);
			const { user } = await api<{ user: User }>("/api/auth/session");
			setCurrentUser(user);
			localStorage.setItem(cachedUserStorageKey, JSON.stringify(user));
			await loadData();
		} catch (_err) {
			setSessionToken(null);
			setCurrentUser(null);
			localStorage.removeItem("sessionToken");
			localStorage.removeItem(cachedUserStorageKey);
			localStorage.removeItem(cachedFriendsStorageKey);
			localStorage.removeItem(cachedLastYoInfoStorageKey);
			setAuthStep("login");
			setPendingUsername("");
			setHasCachedFriends(false);
			setLastYoInfo([]);
			setHasCachedLastYoInfo(false);
		}
	}

	function logout() {
		const token = sessionToken();
		if (token) {
			api("/api/auth/logout", {
				method: "POST",
				headers: { "X-Session-Token": token },
			}).catch((err) => {
				console.error("Logout failed:", err);
			});
		}
		setCurrentUser(null);
		localStorage.removeItem("sessionToken");
		localStorage.removeItem(cachedUserStorageKey);
		localStorage.removeItem(cachedFriendsStorageKey);
		localStorage.removeItem(cachedLastYoInfoStorageKey);
		setSessionToken(null);
		setAuthStep("login");
		setPendingUsername("");
		setFriends([]);
		setLastYoInfo([]);
		setHasCachedFriends(false);
		setHasCachedLastYoInfo(false);

		const registration = swRegistration();
		if (registration && token) {
			unsubscribePush(registration, token).catch((err) => {
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

	async function unsubscribePush(
		registration: ServiceWorkerRegistration,
		token?: string,
	) {
		const subscription = await registration.pushManager.getSubscription();
		if (!subscription) {
			return;
		}

		await api("/api/push/unsubscribe", {
			method: "POST",
			headers: token ? { "X-Session-Token": token } : undefined,
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
			setLastYoInfo((prev) => {
				const existing = prev.find((info) => info.friend_id === toUserId);
				const nextInfo = existing
					? prev.map((info) =>
							info.friend_id === toUserId
								? {
										...info,
										last_yo_type: "oy",
										last_yo_created_at: now,
										last_yo_from_user_id: user.id,
										streak,
									}
								: info,
						)
					: [
							...prev,
							{
								friend_id: toUserId,
								last_yo_type: "oy",
								last_yo_created_at: now,
								last_yo_from_user_id: user.id,
								streak,
							},
						];
				localStorage.setItem(
					cachedLastYoInfoStorageKey,
					JSON.stringify(nextInfo),
				);
				setHasCachedLastYoInfo(true);
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
			setLastYoInfo((prev) => {
				const existing = prev.find((info) => info.friend_id === toUserId);
				const nextInfo = existing
					? prev.map((info) =>
							info.friend_id === toUserId
								? {
										...info,
										last_yo_type: "lo",
										last_yo_created_at: now,
										last_yo_from_user_id: user.id,
										streak,
									}
								: info,
						)
					: [
							...prev,
							{
								friend_id: toUserId,
								last_yo_type: "lo",
								last_yo_created_at: now,
								last_yo_from_user_id: user.id,
								streak,
							},
						];
				localStorage.setItem(
					cachedLastYoInfoStorageKey,
					JSON.stringify(nextInfo),
				);
				setHasCachedLastYoInfo(true);
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
		if (initialSessionToken) {
			setLoadingFriends(true);
			setBooting(false);
			await restoreSession(initialSessionToken);
			if (!currentUser()) {
				setLoadingFriends(false);
			}
			return;
		}
		setBooting(false);
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
			if (currentUser()) {
				void loadFriends();
				void loadLastYoInfo();
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

	createEffect(() => {
		if (tab() === "friends" && currentUser()) {
			loadFriends();
			loadLastYoInfo();
		}
	});

	createEffect(() => {
		const currentTab = tab();
		if (!hasUpdatedHash) {
			hasUpdatedHash = true;
			return;
		}
		if (currentTab === "friends") {
			if (window.location.hash) {
				history.replaceState(
					null,
					"",
					window.location.pathname + window.location.search,
				);
			}
			return;
		}
		const hash = initialHashUsesParam ? `tab=${currentTab}` : currentTab;
		if (window.location.hash !== `#${hash}`) {
			history.replaceState(
				null,
				"",
				`${window.location.pathname}${window.location.search}#${hash}`,
			);
		}
	});

	const renderApp = (user: User) =>
		isAdminRoute ? (
			<AdminDashboard user={user} api={api} onLogout={logout} />
		) : (
			<Screen>
				<AppHeader
					user={user}
					onLogout={logout}
					onSetupNotifications={handleSetupNotifications}
				/>

				<Tabs.Root value={tab()} onChange={setTab} class="app-tabs-root">
					<Tabs.List class="app-tabs">
						<Tabs.Trigger class="app-tab" value="friends">
							Friends
						</Tabs.Trigger>
						<Tabs.Trigger class="app-tab" value="oys">
							Oys
						</Tabs.Trigger>
						<Tabs.Trigger class="app-tab" value="add">
							Add Friend
						</Tabs.Trigger>
					</Tabs.List>

					<SwipeableTabs order={tabOrder} value={tab} onChange={setTab}>
						<Tabs.Content value="friends">
							<FriendsList
								friends={friendsWithLastYo()}
								currentUserId={user.id}
								loading={() => loadingFriends() && !hasCachedFriends()}
								loadingLastYo={() =>
									loadingLastYoInfo() && !hasCachedLastYoInfo()
								}
								onSendOy={sendOy}
								onSendLo={sendLo}
							/>
						</Tabs.Content>

						<Tabs.Content value="oys">
							<OysList
								oys={oys()}
								currentUserId={user.id}
								openLocations={openLocations}
								onToggleLocation={toggleLocation}
								hasMore={hasMoreOys}
								loadingMore={loadingMoreOys}
								loading={loadingOys}
								onLoadMore={() => loadOysPage()}
							/>
						</Tabs.Content>

						<Tabs.Content value="add">
							<AddFriendForm
								api={api}
								currentUser={currentUser}
								friends={friends}
							/>
						</Tabs.Content>
					</SwipeableTabs>
				</Tabs.Root>
			</Screen>
		);

	return (
		<>
			<OyToastContainer />
			<Show when={!booting()}>
				<Show
					when={currentUser()}
					fallback={
						<>
							<Show when={authStep() === "login"}>
								<LoginScreen onSubmit={handleLogin} />
							</Show>
							<Show when={authStep() === "phone"}>
								<PhoneVerificationScreen onSubmit={handlePhoneSubmit} />
							</Show>
							<Show when={authStep() === "verify"}>
								<VerifyCodeScreen onSubmit={handleVerifySubmit} />
							</Show>
						</>
					}
				>
					{(user) => renderApp(user())}
				</Show>
			</Show>
		</>
	);
}
