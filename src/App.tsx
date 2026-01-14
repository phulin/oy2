import { registerSW } from "virtual:pwa-register";
import { Tabs } from "@kobalte/core";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { AddFriendForm } from "./components/AddFriendForm";
import { AppHeader } from "./components/AppHeader";
import { FriendsList } from "./components/FriendsList";
import { LoginScreen } from "./components/LoginScreen";
import { OysList } from "./components/OysList";
import { Screen } from "./components/Screen";
import { SwipeableTabs } from "./components/SwipeableTabs";
import type { Friend, Oy, User } from "./types";
import { urlBase64ToUint8Array } from "./utils";
import "./App.css";

const urlParams = new URLSearchParams(window.location.search);
const hashValue = window.location.hash.replace(/^#/, "");
const hashParams = new URLSearchParams(hashValue);
const initialHashUsesParam = hashParams.has("tab");
const requestedTab = hashValue ? (hashParams.get("tab") ?? hashValue) : null;
const requestedOyId = urlParams.get("yo");
const requestedExpand = urlParams.get("expand");
const initialTab =
	requestedTab && ["friends", "oys", "add"].includes(requestedTab)
		? requestedTab
		: "friends";

export default function App() {
	const [booting, setBooting] = createSignal(true);
	const [currentUser, setCurrentUser] = createSignal<User | null>(null);
	const [friends, setFriends] = createSignal<Friend[]>([]);
	const [oys, setOys] = createSignal<Oy[]>([]);
	const [tab, setTab] = createSignal(initialTab);
	const [openLocations, setOpenLocations] = createSignal<Set<number>>(
		new Set(),
	);
	const [swRegistration, setSwRegistration] =
		createSignal<ServiceWorkerRegistration | null>(null);
	const parsedOyId = requestedOyId ? Number(requestedOyId) : null;
	let pendingExpandOyId: number | null =
		parsedOyId !== null && Number.isFinite(parsedOyId) ? parsedOyId : null;
	let pendingExpandType: string | null = requestedExpand;
	let hasUpdatedHash = false;
	const tabOrder = ["friends", "oys", "add"] as const;

	async function api<T>(
		endpoint: string,
		options: RequestInit = {},
	): Promise<T> {
		const headers = new Headers(options.headers || {});
		headers.set("Content-Type", "application/json");

		const user = currentUser();
		if (user) {
			headers.set("X-Username", user.username);
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
		const user = currentUser() as User;
		console.log("Push subscription saved", {
			endpoint: subscription.endpoint,
			userId: user.id,
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
		try {
			const { friends: data } = await api<{ friends: Friend[] }>(
				"/api/friends",
			);
			setFriends(data || []);
		} catch (err) {
			console.error("Failed to load friends:", err);
		}
	}

	async function loadOys() {
		try {
			const { oys: oysData } = await api<{ oys: Oy[] }>("/api/oys");
			setOys(oysData || []);
		} catch (err) {
			console.error("Failed to load oys:", err);
		}

		const expandId = pendingExpandOyId;
		if (expandId !== null && pendingExpandType === "location") {
			setOpenLocations((prev) => {
				const next = new Set(prev);
				next.add(expandId);
				return next;
			});
			pendingExpandOyId = null;
			pendingExpandType = null;
		}
	}

	async function loadData() {
		await Promise.all([loadFriends(), loadOys()]);
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
			const { user } = await api<{ user: User }>("/api/users", {
				method: "POST",
				body: JSON.stringify({ username }),
			});
			setCurrentUser(user);
			localStorage.setItem("username", username);
			await loadData();
		} catch (err) {
			alert((err as Error).message);
		}
	}

	function logout() {
		setCurrentUser(null);
		localStorage.removeItem("username");

		const registration = swRegistration();
		if (registration) {
			unsubscribePush(registration).catch((err) => {
				console.error("Push unsubscribe failed:", err);
			});
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
			await api("/api/oy", {
				method: "POST",
				body: JSON.stringify({ toUserId }),
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

			await api("/api/lo", {
				method: "POST",
				body: JSON.stringify({ toUserId, location }),
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
		const savedUsername = localStorage.getItem("username");
		if (savedUsername) {
			try {
				const { user } = await api<{ user: User }>("/api/users", {
					method: "POST",
					body: JSON.stringify({ username: savedUsername }),
				});
				setCurrentUser(user);
				await loadData();
			} catch (_err) {
				localStorage.removeItem("username");
			}
		}
		setBooting(false);
	});

	onMount(() => {
		if (!("serviceWorker" in navigator)) {
			return;
		}

		const oyAudio = new Audio("/oy.wav");
		oyAudio.preload = "auto";

		const onMessage = (event: MessageEvent) => {
			const payload = event.data?.payload as { type?: string } | undefined;
			if (payload?.type !== "oy") {
				return;
			}
			void oyAudio.play();
		};

		navigator.serviceWorker.addEventListener("message", onMessage);
		onCleanup(() => {
			navigator.serviceWorker.removeEventListener("message", onMessage);
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
			loadOys();
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

	return (
		<Show when={!booting()}>
			<Show
				when={currentUser()}
				fallback={<LoginScreen onSubmit={handleLogin} />}
			>
				<Screen>
					<Show when={currentUser()}>
						{(user) => <AppHeader user={user()} onLogout={logout} />}
					</Show>

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
									friends={friends()}
									onSendOy={sendOy}
									onSendLo={sendLo}
								/>
							</Tabs.Content>

							<Tabs.Content value="oys">
								<OysList
									oys={oys()}
									openLocations={openLocations}
									onToggleLocation={toggleLocation}
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
			</Show>
		</Show>
	);
}
