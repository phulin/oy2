import { Tabs } from "@kobalte/core";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { AddFriendForm } from "./components/AddFriendForm";
import { AppHeader } from "./components/AppHeader";
import { FriendsList } from "./components/FriendsList";
import { LoginScreen } from "./components/LoginScreen";
import { PullIndicator } from "./components/PullIndicator";
import { UpdateToast } from "./components/UpdateToast";
import { YosList } from "./components/YosList";
import type { Friend, User, Yo } from "./types";
import { urlBase64ToUint8Array } from "./utils";

const urlParams = new URLSearchParams(window.location.search);
const hashValue = window.location.hash.replace(/^#/, "");
const hashParams = new URLSearchParams(hashValue);
const initialHashUsesParam = hashParams.has("tab");
const requestedTab = hashValue
	? hashParams.get("tab") ?? hashValue
	: null;
const requestedYoId = urlParams.get("yo");
const requestedExpand = urlParams.get("expand");
const initialTab =
	requestedTab && ["friends", "oys", "add"].includes(requestedTab)
		? requestedTab
		: "friends";

export default function App() {
	const [booting, setBooting] = createSignal(true);
	const [currentUser, setCurrentUser] = createSignal<User | null>(null);
	const [friends, setFriends] = createSignal<Friend[]>([]);
	const [yos, setYos] = createSignal<Yo[]>([]);
	const [tab, setTab] = createSignal(initialTab);
	const [openLocations, setOpenLocations] = createSignal<Set<number>>(
		new Set(),
	);
	const [swRegistration, setSwRegistration] =
		createSignal<ServiceWorkerRegistration | null>(null);
	const [updateReady, setUpdateReady] = createSignal(false);
	const [updateWaiting, setUpdateWaiting] = createSignal<ServiceWorker | null>(
		null,
	);
	const [pullActive, setPullActive] = createSignal(false);
	const [pullRefreshing, setPullRefreshing] = createSignal(false);
	const parsedYoId = requestedYoId ? Number(requestedYoId) : null;
	let pendingExpandYoId: number | null =
		parsedYoId !== null && Number.isFinite(parsedYoId) ? parsedYoId : null;
	let pendingExpandType: string | null = requestedExpand;
	let hasUpdatedHash = false;

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

		const existing = await registration.pushManager.getSubscription();
		if (existing) {
			await api("/api/push/subscribe", {
				method: "POST",
				body: JSON.stringify(existing.toJSON()),
			});
			return;
		}

		const { publicKey } = await api<{ publicKey: string }>(
			"/api/push/vapid-public-key",
		);
		const subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(publicKey),
		});

		await api("/api/push/subscribe", {
			method: "POST",
			body: JSON.stringify(subscription.toJSON()),
		});
	}

	async function registerServiceWorker() {
		if (!("serviceWorker" in navigator)) {
			return;
		}

		const hostname = window.location.hostname;
		if (hostname === "localhost" || hostname === "127.0.0.1") {
			return;
		}

		const registration = await navigator.serviceWorker.register("/sw.js");
		setSwRegistration(registration);

		if (registration.waiting) {
			setUpdateWaiting(registration.waiting);
			setUpdateReady(true);
		}

		registration.addEventListener("updatefound", () => {
			const newWorker = registration.installing;
			if (!newWorker) {
				return;
			}
			newWorker.addEventListener("statechange", () => {
				if (
					newWorker.state === "installed" &&
					navigator.serviceWorker.controller
				) {
					setUpdateWaiting(registration.waiting);
					setUpdateReady(true);
				}
			});
		});

		navigator.serviceWorker.addEventListener("controllerchange", () => {
			window.location.reload();
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

	async function loadYos() {
		try {
			const { yos: data } = await api<{ yos: Yo[] }>("/api/oys");
			setYos(data || []);
		} catch (err) {
			console.error("Failed to load oys:", err);
		}

		const expandId = pendingExpandYoId;
		if (expandId !== null && pendingExpandType === "location") {
			setOpenLocations((prev) => {
				const next = new Set(prev);
				next.add(expandId);
				return next;
			});
			pendingExpandYoId = null;
			pendingExpandType = null;
		}
	}

	async function loadData() {
		await Promise.all([loadFriends(), loadYos()]);
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
	}

	async function sendYo(toUserId: number) {
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

	createEffect(() => {
		const registration = swRegistration();
		if (registration && currentUser()) {
			ensurePushSubscription(registration).catch((err) => {
				console.error("Push subscription refresh failed:", err);
			});
		}
	});

	function applyUpdate() {
		const waiting = updateWaiting();
		if (waiting) {
			waiting.postMessage({ type: "SKIP_WAITING" });
		}
	}

	createEffect(() => {
		if (tab() === "oys" && currentUser()) {
			loadYos();
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
				history.replaceState(null, "", window.location.pathname + window.location.search);
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

	onMount(() => {
		let pullStartY: number | null = null;
		let pullTriggered = false;

		const onTouchStart = (event: TouchEvent) => {
			if (tab() !== "oys" || window.scrollY !== 0) {
				return;
			}
			const target = event.target as HTMLElement | null;
			if (target?.closest(".yo-location-map")) {
				return;
			}
			pullStartY = event.touches[0].clientY;
			pullTriggered = false;
		};

		const onTouchMove = (event: TouchEvent) => {
			if (pullStartY === null || tab() !== "oys") {
				return;
			}
			const delta = event.touches[0].clientY - pullStartY;
			if (delta <= 0) {
				setPullActive(false);
				return;
			}
			event.preventDefault();
			pullTriggered = delta > 70;
			setPullActive(true);
		};

		const onTouchEnd = () => {
			if (pullStartY === null) {
				return;
			}
			if (pullTriggered) {
				setPullRefreshing(true);
				loadYos().finally(() => {
					setPullRefreshing(false);
					setPullActive(false);
				});
			} else {
				setPullActive(false);
			}
			pullStartY = null;
			pullTriggered = false;
		};

		window.addEventListener("touchstart", onTouchStart);
		window.addEventListener("touchmove", onTouchMove, { passive: false });
		window.addEventListener("touchend", onTouchEnd);

		onCleanup(() => {
			window.removeEventListener("touchstart", onTouchStart);
			window.removeEventListener("touchmove", onTouchMove);
			window.removeEventListener("touchend", onTouchEnd);
		});
	});

	return (
		<>
			<PullIndicator active={pullActive()} refreshing={pullRefreshing()} />
			<Show when={updateReady()}>
				<UpdateToast onRefresh={applyUpdate} />
			</Show>

			<Show when={!booting()}>
				<Show
					when={currentUser()}
					fallback={<LoginScreen onSubmit={handleLogin} />}
				>
					<div class="screen">
						<div class="container">
							<Show when={currentUser()}>
								{(user) => <AppHeader user={user()} onLogout={logout} />}
							</Show>

							<Tabs.Root value={tab()} onChange={setTab}>
								<Tabs.List class="tabs">
									<Tabs.Trigger class="tab" value="friends">
										Friends
									</Tabs.Trigger>
								<Tabs.Trigger class="tab" value="oys">
									Oys
								</Tabs.Trigger>
									<Tabs.Trigger class="tab" value="add">
										Add Friend
									</Tabs.Trigger>
								</Tabs.List>

								<Tabs.Content value="friends">
									<FriendsList
										friends={friends()}
										onSendYo={sendYo}
										onSendLo={sendLo}
									/>
								</Tabs.Content>

								<Tabs.Content value="oys">
									<YosList
										yos={yos()}
										openLocations={openLocations}
										onToggleLocation={toggleLocation}
									/>
								</Tabs.Content>

								<Tabs.Content value="add">
									<AddFriendForm api={api} currentUser={currentUser} />
								</Tabs.Content>
							</Tabs.Root>
						</div>
					</div>
				</Show>
			</Show>
		</>
	);
}
