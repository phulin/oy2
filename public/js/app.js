// State
let currentUser = null;
let friends = [];
let yos = [];

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

    // Request notification permission and subscribe to push
    if ('Notification' in window && 'PushManager' in window) {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        await subscribeToPush(registration);
      }
    }
  } catch (err) {
    console.error('Service Worker registration failed:', err);
  }
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
  loginScreen.classList.remove('hidden');
  mainScreen.classList.add('hidden');
}

function showMainScreen() {
  loginScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  currentUsernameEl.textContent = currentUser.username;
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
      registerServiceWorker();
      loadData();
    })
    .catch(() => {
      localStorage.removeItem('username');
    });
}

// Tab switching
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;

    tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');

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
      <button class="btn-yo" data-friend-id="${friend.id}">Oy!</button>
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
}

function renderYos() {
  if (yos.length === 0) {
    yosList.innerHTML = '<p class="empty-state">No Oys yet!</p>';
    return;
  }

  yosList.innerHTML = yos
    .map(
      (yo) => `
    <div class="list-item">
      <div class="list-item-content">
        <div class="list-item-title">Oy from ${escapeHtml(yo.from_username)}</div>
        <div class="list-item-subtitle">${formatTime(yo.created_at)}</div>
      </div>
    </div>
  `
    )
    .join('');
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
