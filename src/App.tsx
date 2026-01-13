import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Tabs } from '@kobalte/core';
import { initLocationMap } from './map';

const urlParams = new URLSearchParams(window.location.search);
const requestedTab = urlParams.get('tab');
const requestedYoId = urlParams.get('yo');
const requestedExpand = urlParams.get('expand');
const initialTab =
  requestedTab && ['friends', 'yos', 'add'].includes(requestedTab)
    ? requestedTab
    : 'friends';

type User = {
  id: number;
  username: string;
};

type Friend = {
  id: number;
  username: string;
};

type YoPayload = {
  lat: number;
  lon: number;
  accuracy?: number | null;
};

type Yo = {
  id: number;
  from_username: string;
  created_at: number;
  type: string;
  payload?: YoPayload | null;
};

export default function App() {
  const [booting, setBooting] = createSignal(true);
  const [currentUser, setCurrentUser] = createSignal<User | null>(null);
  const [friends, setFriends] = createSignal<Friend[]>([]);
  const [yos, setYos] = createSignal<Yo[]>([]);
  const [tab, setTab] = createSignal(initialTab);
  const [openLocations, setOpenLocations] = createSignal<Set<number>>(new Set());
  const [swRegistration, setSwRegistration] = createSignal<ServiceWorkerRegistration | null>(null);
  const [updateReady, setUpdateReady] = createSignal(false);
  const [updateWaiting, setUpdateWaiting] = createSignal<ServiceWorker | null>(null);
  const [pullActive, setPullActive] = createSignal(false);
  const [pullRefreshing, setPullRefreshing] = createSignal(false);
  const parsedYoId = requestedYoId ? Number(requestedYoId) : null;
  let pendingExpandYoId: number | null =
    parsedYoId !== null && Number.isFinite(parsedYoId) ? parsedYoId : null;
  let pendingExpandType: string | null = requestedExpand;

  async function api<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (currentUser()) {
      headers['X-Username'] = currentUser()!.username;
    }

    const response = await fetch(endpoint, { ...options, headers });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }
    return response.json() as Promise<T>;
  }

  async function ensurePushSubscription(registration: ServiceWorkerRegistration) {
    if (!('Notification' in window && 'PushManager' in window)) {
      return;
    }

    let permission = Notification.permission;
    if (permission === 'denied') {
      return;
    }

    if (permission !== 'granted') {
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      return;
    }

    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await api('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify(existing.toJSON()),
      });
      return;
    }

    const { publicKey } = await api<{ publicKey: string }>('/api/push/vapid-public-key');
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await api('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription.toJSON()),
    });
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return;
    }

    const registration = await navigator.serviceWorker.register('/sw.js');
    setSwRegistration(registration);

    if (registration.waiting) {
      setUpdateWaiting(registration.waiting);
      setUpdateReady(true);
    }

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) {
        return;
      }
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          setUpdateWaiting(registration.waiting);
          setUpdateReady(true);
        }
      });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }

  async function loadFriends() {
    try {
      const { friends: data } = await api<{ friends: Friend[] }>('/api/friends');
      setFriends(data || []);
    } catch (err) {
      console.error('Failed to load friends:', err);
    }
  }

  async function loadYos() {
    try {
      const { yos: data } = await api<{ yos: Yo[] }>('/api/oys');
      setYos(data || []);
    } catch (err) {
      console.error('Failed to load oys:', err);
    }

    if (pendingExpandYoId && pendingExpandType === 'location') {
      setOpenLocations((prev) => {
        const next = new Set(prev);
        next.add(pendingExpandYoId);
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
    const username = String(formData.get('username') || '').trim();
    if (!username) {
      return;
    }
    try {
      const { user } = await api<{ user: User }>('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      setCurrentUser(user);
      localStorage.setItem('username', username);
      await loadData();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  function logout() {
    setCurrentUser(null);
    localStorage.removeItem('username');
  }

  async function sendYo(toUserId: number) {
    try {
      await api('/api/oy', {
        method: 'POST',
        body: JSON.stringify({ toUserId }),
      });
    } catch (err) {
      alert((err as Error).message);
    }
  }

  function getCurrentPosition(options?: PositionOptions) {
    return new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
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

      await api('/api/lo', {
        method: 'POST',
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
    const savedUsername = localStorage.getItem('username');
    if (savedUsername) {
      try {
        const { user } = await api<{ user: User }>('/api/users', {
          method: 'POST',
          body: JSON.stringify({ username: savedUsername }),
        });
        setCurrentUser(user);
        await loadData();
      } catch (err) {
        localStorage.removeItem('username');
      }
    }
    setBooting(false);
  });

  createEffect(() => {
    const registration = swRegistration();
    if (registration && currentUser()) {
      ensurePushSubscription(registration).catch((err) => {
        console.error('Push subscription refresh failed:', err);
      });
    }
  });

  function applyUpdate() {
    const waiting = updateWaiting();
    if (waiting) {
      waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }

  createEffect(() => {
    if (tab() === 'yos' && currentUser()) {
      loadYos();
    }
  });

  onMount(() => {
    let pullStartY: number | null = null;
    let pullTriggered = false;

    const onTouchStart = (event: TouchEvent) => {
      if (tab() !== 'yos' || window.scrollY !== 0) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest('.yo-location-map')) {
        return;
      }
      pullStartY = event.touches[0].clientY;
      pullTriggered = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (pullStartY === null || tab() !== 'yos') {
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

    window.addEventListener('touchstart', onTouchStart);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);

    onCleanup(() => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    });
  });

  return (
    <>
      <div
        id="pull-indicator"
        classList={{ active: pullActive(), refreshing: pullRefreshing() }}
      />
      <Show when={updateReady()}>
        <div class="update-toast">
          <span>Update available</span>
          <button class="btn-secondary" type="button" onClick={applyUpdate}>
            Refresh
          </button>
        </div>
      </Show>

      <Show when={!booting()}>
        <Show
          when={currentUser()}
          fallback={
            <div class="screen">
              <div class="container">
                <h1 class="logo">Oy</h1>
                <p class="tagline">Send Oys to your friends</p>
                <form onSubmit={handleLogin}>
                  <input
                    type="text"
                    name="username"
                    placeholder="Enter username"
                    autocomplete="username"
                    required
                    minlength="2"
                    maxlength="20"
                  />
                  <button type="submit" class="btn-primary">
                    Get Started
                  </button>
                </form>
              </div>
            </div>
          }
        >
          <div class="screen">
            <div class="container">
              <div class="header">
                <h1 class="logo-small">Oy</h1>
                <div class="user-info">
                  <span>{currentUser()?.username}</span>
                  <button class="btn-text" type="button" onClick={logout}>
                    Logout
                  </button>
                </div>
              </div>

              <Tabs.Root value={tab()} onChange={setTab}>
                <Tabs.List class="tabs">
                  <Tabs.Trigger class="tab" value="friends">
                    Friends
                  </Tabs.Trigger>
                  <Tabs.Trigger class="tab" value="yos">
                    Oys
                  </Tabs.Trigger>
                  <Tabs.Trigger class="tab" value="add">
                    Add Friend
                  </Tabs.Trigger>
                </Tabs.List>

                <Tabs.Content value="friends">
                  <div class="list">
                    <Show
                      when={friends().length > 0}
                      fallback={<p class="empty-state">No friends yet. Add some!</p>}
                    >
                      <For each={friends()}>
                        {(friend) => (
                          <div class="list-item">
                            <div class="list-item-content">
                              <div class="list-item-title">{friend.username}</div>
                            </div>
                            <div class="list-item-actions">
                              <button
                                class="btn-yo"
                                type="button"
                                onClick={() => sendYo(friend.id)}
                              >
                                Oy!
                              </button>
                              <button
                                class="btn-lo"
                                type="button"
                                onClick={() => sendLo(friend.id)}
                              >
                                Lo!
                              </button>
                            </div>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                </Tabs.Content>

                <Tabs.Content value="yos">
                  <div class="list">
                    <Show
                      when={yos().length > 0}
                      fallback={<p class="empty-state">No Oys yet!</p>}
                    >
                      <For each={yos()}>
                        {(yo) => {
                          const isLocation = yo.type === 'lo' && !!yo.payload;
                          const payload = yo.payload as YoPayload;
                          const title = isLocation
                            ? `Lo from ${yo.from_username}`
                            : `Oy from ${yo.from_username}`;
                          const isOpen = () => openLocations().has(yo.id);

                          return (
                            <div
                              class={`list-item${isLocation ? ' list-item-location' : ''}`}
                              onClick={() => isLocation && toggleLocation(yo.id)}
                              data-yo-id={yo.id}
                            >
                              <div class="list-item-content">
                                <div class="list-item-header">
                                  <div class="list-item-text">
                                    <div class="list-item-title">{title}</div>
                                    <div class="list-item-subtitle">
                                      {formatTime(yo.created_at)}
                                    </div>
                                  </div>
                                  <Show when={isLocation}>
                                    <div class="list-item-toggle-slot">
                                      <button
                                        class="yo-location-toggle"
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          toggleLocation(yo.id);
                                        }}
                                      >
                                        <span class="yo-location-button">
                                          <span
                                            class={`yo-location-arrow${
                                              isOpen() ? ' is-open' : ''
                                            }`}
                                          />
                                        </span>
                                      </button>
                                    </div>
                                  </Show>
                                </div>
                                <Show when={isLocation}>
                                  <div class="list-item-map-slot">
                                    <div
                                      class={`location-panel${isOpen() ? ' open' : ''}`}
                                    >
                                      <LocationMap
                                        lat={payload.lat}
                                        lon={payload.lon}
                                        open={isOpen()}
                                      />
                                    </div>
                                  </div>
                                </Show>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </Show>
                  </div>
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

type LocationMapProps = {
  lat: number;
  lon: number;
  open: boolean;
};

function LocationMap(props: LocationMapProps) {
  let container: HTMLDivElement | undefined;

  createEffect(() => {
    if (props.open && container) {
      initLocationMap(container, props.lat, props.lon);
    }
  });

  return (
    <div
      class="yo-location-map"
      ref={(el) => {
        container = el as HTMLDivElement;
      }}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

type SearchUser = Friend & { added?: boolean };

type AddFriendFormProps = {
  api: <T>(endpoint: string, options?: RequestInit) => Promise<T>;
  currentUser: () => User | null;
};

function AddFriendForm(props: AddFriendFormProps) {
  const [results, setResults] = createSignal<SearchUser[]>([]);
  const [query, setQuery] = createSignal('');
  let debounce: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    const value = query().trim();
    clearTimeout(debounce);
    if (value.length < 2) {
      setResults([]);
      return;
    }

    debounce = setTimeout(async () => {
      try {
        const { users } = await props.api<{ users: SearchUser[] }>(
          `/api/users/search?q=${encodeURIComponent(value)}`
        );
        setResults(users || []);
      } catch (err) {
        console.error('Search failed:', err);
      }
    }, 300);
  });

  async function addFriend(friendId: number) {
    try {
      await props.api('/api/friends', {
        method: 'POST',
        body: JSON.stringify({ friendId }),
      });
      setResults((prev) =>
        prev.map((user) =>
          user.id === friendId ? { ...user, added: true } : user
        )
      );
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const showPrompt = () => query().trim().length < 2;

  return (
    <>
      <form onSubmit={(event) => event.preventDefault()}>
        <input
          type="text"
          placeholder="Search username"
          autocomplete="off"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </form>
      <div class="list">
        <Show
          when={results().length > 0}
          fallback={
            <p class="empty-state">
              {showPrompt() ? 'Search for friends to add' : 'No users found'}
            </p>
          }
        >
          <For each={results().filter((user) => user.id !== props.currentUser()?.id)}>
            {(user) => (
              <div class="list-item">
                <div class="list-item-content">
                  <div class="list-item-title">{user.username}</div>
                </div>
                <button
                  class="btn-secondary"
                  type="button"
                  disabled={user.added}
                  onClick={() => addFriend(user.id)}
                >
                  {user.added ? 'Added!' : 'Add Friend'}
                </button>
              </div>
            )}
          </For>
        </Show>
      </div>
    </>
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function formatTime(timestamp: number) {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
