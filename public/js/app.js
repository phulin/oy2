import { initLocationMap } from './map.js';

// State
let currentUser = null;
let friends = [];
let yos = [];
let pendingExpandYoId = null;
let pendingExpandType = null;
const urlParams = new URLSearchParams(window.location.search);
const requestedTab = urlParams.get('tab');
const requestedYoId = urlParams.get('yo');
const requestedExpand = urlParams.get('expand');
const initialTab = ['friends', 'yos', 'add'].includes(requestedTab) ? requestedTab : 'friends';
let activeTab = initialTab;

if (requestedYoId && !Number.isNaN(Number(requestedYoId))) {
  pendingExpandYoId = Number(requestedYoId);
  pendingExpandType = requestedExpand;
}

// DOM elements
const loginScreen = document.getElementById('login-screen');
const mainScreen = document.getElementById('main-screen');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username-input');
const currentUsernameEl = document.getElementById('current-username');
const logoutBtn = document.getElementById('logout-btn');

const tabs = document.querySelectorAll('.tab');
const friendsTab = document.getElementById('friends-tab');
const yosTab = document.getElementById('yos-tab');
const addTab = document.getElementById('add-tab');

const friendsList = document.getElementById('friends-list');
const yosList = document.getElementById('yos-list');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const bodyEl = document.body;
const pullIndicator = document.getElementById('pull-indicator');

function finishBoot() {
  bodyEl.classList.remove('booting');
}

// API helper
async function api(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (currentUser) {
    headers['X-Username'] = currentUser.username;
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

// Service Worker & Push Notifications
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.log('Service Worker not supported');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    console.log('Service Worker registered');

    await ensurePushSubscription(registration);
  } catch (err) {
    console.error('Service Worker registration failed:', err);
  }
}

async function ensurePushSubscription(registration) {
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
    try {
      await api('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify(existing.toJSON()),
      });
      console.log('Push subscription refreshed');
    } catch (err) {
      console.error('Push subscription refresh failed:', err);
    }
    return;
  }

  await subscribeToPush(registration);
}

async function subscribeToPush(registration) {
  try {
    const { publicKey } = await api('/api/push/vapid-public-key');

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await api('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription.toJSON()),
    });

    console.log('Push subscription successful');
  } catch (err) {
    console.error('Push subscription failed:', err);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Login/Logout
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = usernameInput.value.trim();

  try {
    const { user } = await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });

    currentUser = user;
    localStorage.setItem('username', username);

    showMainScreen();
    setActiveTab(initialTab);
    await registerServiceWorker();
    await loadData();
  } catch (err) {
    alert(err.message);
  }
});

logoutBtn.addEventListener('click', () => {
  currentUser = null;
  localStorage.removeItem('username');
  showLoginScreen();
});

function showLoginScreen() {
  finishBoot();
  loginScreen.classList.remove('hidden');
  mainScreen.classList.add('hidden');
}

function showMainScreen() {
  finishBoot();
  loginScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  currentUsernameEl.textContent = currentUser.username;
}

function setActiveTab(tabName) {
  activeTab = tabName;
  tabs.forEach((t) => t.classList.remove('active'));
  tabs.forEach((t) => {
    if (t.dataset.tab === tabName) {
      t.classList.add('active');
    }
  });

  friendsTab.classList.add('hidden');
  yosTab.classList.add('hidden');
  addTab.classList.add('hidden');

  if (tabName === 'friends') {
    friendsTab.classList.remove('hidden');
  } else if (tabName === 'yos') {
    yosTab.classList.remove('hidden');
    loadYos();
  } else if (tabName === 'add') {
    addTab.classList.remove('hidden');
  }
}

// Auto-login if username exists
const savedUsername = localStorage.getItem('username');
if (savedUsername) {
  api('/api/users', {
    method: 'POST',
    body: JSON.stringify({ username: savedUsername }),
  })
    .then(({ user }) => {
      currentUser = user;
      showMainScreen();
      setActiveTab(initialTab);
      registerServiceWorker();
      loadData();
    })
    .catch(() => {
      localStorage.removeItem('username');
      showLoginScreen();
    })
    .finally(() => {
    });
} else {
  showLoginScreen();
}

// Tab switching
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    setActiveTab(tabName);
  });
});

// Load data
async function loadData() {
  await loadFriends();
  await loadYos();
}

async function loadFriends() {
  try {
    const { friends: data } = await api('/api/friends');
    friends = data;
    renderFriends();
  } catch (err) {
    console.error('Failed to load friends:', err);
  }
}

async function loadYos() {
  try {
    const { yos: data } = await api('/api/oys');
    yos = data;
    renderYos();
  } catch (err) {
    console.error('Failed to load oys:', err);
  }
}

let pullStartY = null;
let pullTriggered = false;

function isAtTop() {
  return window.scrollY === 0;
}

function showPullIndicator(isActive) {
  pullIndicator.classList.toggle('active', isActive);
}

async function runPullRefresh() {
  pullIndicator.classList.add('refreshing');
  await loadYos();
  pullIndicator.classList.remove('refreshing');
  pullIndicator.classList.remove('active');
}

window.addEventListener('touchstart', (event) => {
  if (activeTab !== 'yos' || !isAtTop()) {
    return;
  }
  if (event.target.closest('.yo-location-map')) {
    return;
  }
  pullStartY = event.touches[0].clientY;
  pullTriggered = false;
});

window.addEventListener('touchmove', (event) => {
  if (pullStartY === null || activeTab !== 'yos') {
    return;
  }
  const delta = event.touches[0].clientY - pullStartY;
  if (delta <= 0) {
    showPullIndicator(false);
    return;
  }
  event.preventDefault();
  const threshold = 70;
  pullTriggered = delta > threshold;
  showPullIndicator(true);
}, { passive: false });

window.addEventListener('touchend', () => {
  if (pullStartY === null) {
    return;
  }
  if (pullTriggered) {
    runPullRefresh();
  } else {
    pullIndicator.classList.remove('active');
  }
  pullStartY = null;
  pullTriggered = false;
});

function renderFriends() {
  if (friends.length === 0) {
    friendsList.innerHTML = '<p class="empty-state">No friends yet. Add some!</p>';
    return;
  }

  friendsList.innerHTML = friends
    .map(
      (friend) => `
    <div class="list-item">
      <div class="list-item-content">
        <div class="list-item-title">${escapeHtml(friend.username)}</div>
      </div>
      <div class="list-item-actions">
        <button class="btn-yo" data-friend-id="${friend.id}">Oy!</button>
        <button class="btn-lo" data-friend-id="${friend.id}">Lo!</button>
      </div>
    </div>
  `
    )
    .join('');

  // Add click handlers to Oy buttons
  friendsList.querySelectorAll('.btn-yo').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const friendId = parseInt(btn.dataset.friendId);
      await sendYo(friendId);
      btn.classList.add('pulse');
      setTimeout(() => btn.classList.remove('pulse'), 300);
    });
  });

  friendsList.querySelectorAll('.btn-lo').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const friendId = parseInt(btn.dataset.friendId);
      await sendLo(friendId);
      btn.classList.add('pulse');
      setTimeout(() => btn.classList.remove('pulse'), 300);
    });
  });
}

function renderYos() {
  if (yos.length === 0) {
    yosList.innerHTML = '<p class="empty-state">No Oys yet!</p>';
    return;
  }

  yosList.innerHTML = yos
    .map(
      (yo) => {
        const isLocation = yo.type === 'lo' && yo.payload;
        const title = isLocation
          ? `Lo from ${escapeHtml(yo.from_username)}`
          : `Oy from ${escapeHtml(yo.from_username)}`;
        const locationToggle = isLocation
          ? `
            <button class="yo-location-toggle" type="button" aria-label="Toggle location">
              <span class="yo-location-button">
                <span class="yo-location-arrow"></span>
              </span>
            </button>
          `
          : '';

        const cardClass = isLocation ? 'list-item list-item-location' : 'list-item';

        return `
    <div class="${cardClass}" ${isLocation ? `data-location-card="true" data-yo-id="${yo.id}"` : ''}>
      <div class="list-item-content">
        <div class="list-item-header">
          <div class="list-item-text">
            <div class="list-item-title">${title}</div>
            <div class="list-item-subtitle">${formatTime(yo.created_at)}</div>
          </div>
          ${isLocation ? `
            <div class="list-item-toggle-slot">
              ${locationToggle}
            </div>
          ` : ''}
        </div>
        ${isLocation ? `
          <div class="list-item-map-slot" data-location-panel="true" data-open="false">
            <div
              class="yo-location-map"
              data-lat="${yo.payload.lat}"
              data-lon="${yo.payload.lon}"
            ></div>
          </div>
        ` : ''}
      </div>
    </div>
  `
      }
    )
    .join('');

  maybeExpandRequestedYo();
  attachLocationCardToggles();
}

function maybeExpandRequestedYo() {
  if (!pendingExpandYoId) {
    return;
  }

  if (pendingExpandType !== 'location') {
    pendingExpandYoId = null;
    return;
  }

  const card = document.querySelector(`[data-location-card="true"][data-yo-id="${pendingExpandYoId}"]`);
  if (card) {
    const panel = card.querySelector('[data-location-panel="true"]');
    if (panel) {
      panel.dataset.open = 'true';
      const container = panel.querySelector('.yo-location-map');
      initMapInPanel(container);
      const arrow = card.querySelector('.yo-location-arrow');
      if (arrow) {
        arrow.classList.add('is-open');
      }
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  pendingExpandYoId = null;
}

function attachLocationCardToggles() {
  document.querySelectorAll('[data-location-card="true"]').forEach((card) => {
    if (card.dataset.toggleBound === 'true') {
      return;
    }
    card.dataset.toggleBound = 'true';

    card.addEventListener('click', (event) => {
      if (event.target.closest('.yo-location-map')) {
        return;
      }
      if (event.target.closest('.yo-location-toggle')) {
        return;
      }
      const panel = card.querySelector('[data-location-panel="true"]');
      if (!panel) {
        return;
      }
      toggleLocationPanel(panel);
    });
  });

  document.querySelectorAll('.yo-location-toggle').forEach((btn) => {
    if (btn.dataset.toggleBound === 'true') {
      return;
    }
    btn.dataset.toggleBound = 'true';
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const card = btn.closest('[data-location-card="true"]');
      const panel = card?.querySelector('[data-location-panel="true"]');
      if (!panel) {
        return;
      }
      toggleLocationPanel(panel);
    });
  });
}

function toggleLocationPanel(panel) {
  const isOpen = panel.dataset.open === 'true';
  panel.dataset.open = isOpen ? 'false' : 'true';

  const card = panel.closest('[data-location-card="true"]');
  const arrow = card?.querySelector('.yo-location-arrow');
  if (arrow) {
    arrow.classList.toggle('is-open', !isOpen);
  }

  if (!isOpen) {
    const container = panel.querySelector('.yo-location-map');
    initMapInPanel(container);
  }
}

function initMapInPanel(container) {
  if (!container || container.dataset.mapInit === 'true') {
    return;
  }

  const lat = Number(container.dataset.lat);
  const lon = Number(container.dataset.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return;
  }

  try {
    initLocationMap(container, lat, lon);
  } catch (err) {
    console.error('Failed to init map:', err);
  }
}

async function sendYo(toUserId) {
  try {
    await api('/api/oy', {
      method: 'POST',
      body: JSON.stringify({ toUserId }),
    });
  } catch (err) {
    alert(err.message);
  }
}

function getCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

async function sendLo(toUserId) {
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
    alert(err.message);
  }
}

// Search users
let searchTimeout;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const query = searchInput.value.trim();

  if (query.length < 2) {
    searchResults.innerHTML = '<p class="empty-state">Search for friends to add</p>';
    return;
  }

  searchTimeout = setTimeout(async () => {
    try {
      const { users } = await api(`/api/users/search?q=${encodeURIComponent(query)}`);

      if (users.length === 0) {
        searchResults.innerHTML = '<p class="empty-state">No users found</p>';
        return;
      }

      searchResults.innerHTML = users
        .filter((user) => user.id !== currentUser.id)
        .map(
          (user) => `
        <div class="list-item">
          <div class="list-item-content">
            <div class="list-item-title">${escapeHtml(user.username)}</div>
          </div>
          <button class="btn-secondary" data-user-id="${user.id}">Add Friend</button>
        </div>
      `
        )
        .join('');

      // Add click handlers
      searchResults.querySelectorAll('.btn-secondary').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const userId = parseInt(btn.dataset.userId);
          await addFriend(userId);
          btn.textContent = 'Added!';
          btn.disabled = true;
        });
      });
    } catch (err) {
      console.error('Search failed:', err);
    }
  }, 300);
});

async function addFriend(friendId) {
  try {
    await api('/api/friends', {
      method: 'POST',
      body: JSON.stringify({ friendId }),
    });
    await loadFriends();
  } catch (err) {
    alert(err.message);
  }
}

// Utilities
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(timestamp) {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
