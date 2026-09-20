// Secure chat client: shows the message instantly (optimistic render)
// and refreshes via polling every POLL_MS against the Express backend.
// Adapted for the Secret Rotation + LDAP exercise: every request sends the
// CURRENT API secret via the `x-api-key` header (injected by config.js and
// re-rendered whenever the secret rotates), and the user authenticates
// against the LDAP service with the login form.
//
// Two screens only: login and chat. The chat screen has a collapsible left
// sidebar that lists the user's conversations, a search box to find users and
// start new chats, and the conversation itself on the right.
const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const chatScreen = document.getElementById('chat-screen');
const currentUser = document.getElementById('current-user');
const logoutBtn = document.getElementById('logout-btn');
const sidebar = document.getElementById('sidebar');
const toggleSidebar = document.getElementById('toggle-sidebar');
const logoutModal = document.getElementById('logout-modal');
const logoutCancel = document.getElementById('logout-cancel');
const logoutConfirm = document.getElementById('logout-confirm');
const chatSearch = document.getElementById('chat-search');
const sidebarLabel = document.getElementById('sidebar-label');
const chatList = document.getElementById('chat-list');
const noChats = document.getElementById('no-chats');
const noResults = document.getElementById('no-results');
const conversationTitle = document.getElementById('conversation-title');
const messagesBox = document.getElementById('messages');
const banner = document.getElementById('banner');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const sendButton = messageForm.querySelector('button');

const POLL_MS = 3000;
let API_KEY = window.APP_CONFIG?.apiKey;
let myHandle = sessionStorage.getItem('myHandle') || '';
let otherHandle = '';
let lastId = 0;      // largest id confirmed by polling; messages with id <= lastId were already processed
let polling = null;
const elsById = new Map();    // message id -> DOM element (to update without duplicating)
const pendingIds = new Set(); // ids optimistically sent and not yet confirmed by poll
let users = [];               // LDAP directory users (for search)
const chats = new Map();      // handle -> { handle, displayName, lastAt }

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-reads the cache-busted config.json, which nginx re-renders from the
// rotating secret every second. This lets a stale API key heal itself
// without reloading the page. Returns the current key (or null on failure).
async function refreshApiKey() {
  try {
    const resp = await fetch(`/config.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data && data.apiKey) {
      API_KEY = data.apiKey;
      return data.apiKey;
    }
  } catch {
    // Keep the current key; the caller surfaces the original error.
  }
  return null;
}

async function api(path, options = {}, retried = false) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  const resp = await fetch(path, { ...options, headers });
  if (resp.status === 401 && !retried) {
    // A 401 can mean the API secret rotated. Re-read config.json and retry
    // ONLY if the key actually changed, so a wrong LDAP password is reported
    // right away instead of being retried.
    const previous = API_KEY;
    const current = await refreshApiKey();
    if (current && current !== previous) {
      return api(path, options, true);
    }
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

function showBanner(text) {
  banner.textContent = text;
  banner.classList.remove('hidden');
}

function hideBanner() {
  banner.classList.add('hidden');
}

function showLoginError(text) {
  loginError.textContent = text;
  loginError.classList.remove('hidden');
}

function hideLoginError() {
  loginError.classList.add('hidden');
}

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function timeShort(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function setComposerEnabled(on) {
  messageInput.disabled = !on;
  sendButton.disabled = !on;
  messageInput.placeholder = on ? 'Type a message...' : 'Select a chat to start messaging';
}

function setMessagesPlaceholder(text) {
  messagesBox.innerHTML = `<p class="placeholder">${esc(text)}</p>`;
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
async function login(ev) {
  ev.preventDefault();
  if (!API_KEY) {
    showLoginError('Missing API key configuration (config.js not rendered). Start the frontend with the current API_SECRET.');
    return;
  }
  const username = loginUsername.value.trim().replace(/^@/, '').toLowerCase();
  const password = loginPassword.value;
  if (!username || !password) return;
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    hideLoginError();
    myHandle = username;
    sessionStorage.setItem('myHandle', myHandle);
    loginPassword.value = '';
    await enterChatScreen();
  } catch (err) {
    showLoginError(err.message);
  }
}

async function enterChatScreen() {
  loginScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden', 'collapsed');
  currentUser.textContent = `@${myHandle}`;
  otherHandle = '';
  conversationTitle.textContent = 'Select a chat';
  chats.clear();
  setComposerEnabled(false);
  setMessagesPlaceholder('Select a chat to start messaging');
  hideBanner();
  chatSearch.value = '';
  positionToggle();

  // Load the directory (for search) and the existing conversations.
  try {
    const { users: dir } = await api('/api/ldap/users');
    users = (dir || []).filter((u) => u.handle && u.handle !== myHandle);
  } catch (err) {
    users = [];
    showBanner('LDAP user list unavailable: ' + err.message);
  }
  await loadConversations();
}

async function loadConversations() {
  try {
    const { conversations } = await api(`/api/conversations?user=${encodeURIComponent(myHandle)}`);
    for (const c of conversations || []) {
      upsertChat(c.handle, displayNameFor(c.handle), c.last_at);
    }
  } catch (err) {
    showBanner('Unable to load your chats: ' + err.message);
  }
  if (otherHandle) upsertChat(otherHandle, displayNameFor(otherHandle));
  renderSidebar();
}

function displayNameFor(handle) {
  const u = users.find((x) => x.handle === handle);
  return u && u.displayName ? u.displayName : handle;
}

function upsertChat(handle, displayName, lastAt) {
  if (!handle) return;
  const existing = chats.get(handle) || {};
  chats.set(handle, {
    handle,
    displayName: displayName || existing.displayName || handle,
    lastAt: lastAt || existing.lastAt || null,
  });
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
// Places the half-circle tab: at the viewport's left edge when the sidebar is
// collapsed, or inside the block flush with its right edge when it is open.
function positionToggle() {
  if (chatScreen.classList.contains('collapsed')) {
    toggleSidebar.style.left = '0px';
  } else {
    toggleSidebar.style.left = `${sidebar.offsetWidth - toggleSidebar.offsetWidth}px`;
  }
}

function renderSidebar() {
  chatList.innerHTML = '';
  const term = chatSearch.value.trim().toLowerCase();

  if (term) {
    // Search mode: offer matching directory users to start a new chat.
    sidebarLabel.textContent = 'Users';
    noChats.classList.add('hidden');
    const matches = users.filter(
      (u) =>
        u.handle.toLowerCase().includes(term) ||
        (u.displayName || '').toLowerCase().includes(term)
    );
    noResults.classList.toggle('hidden', matches.length > 0);
    for (const u of matches) chatList.appendChild(makeUserItem(u));
    return;
  }

  // Normal mode: list the user's conversations, newest first.
  sidebarLabel.textContent = 'My chats';
  noResults.classList.add('hidden');
  const list = [...chats.values()].sort((a, b) => {
    if (!a.lastAt && !b.lastAt) return 0;
    if (!a.lastAt) return -1;
    if (!b.lastAt) return 1;
    return new Date(b.lastAt) - new Date(a.lastAt);
  });
  noChats.classList.toggle('hidden', list.length > 0);
  for (const c of list) chatList.appendChild(makeChatItem(c));
}

function makeChatItem(chat) {
  const li = document.createElement('li');
  li.className = 'chat-item' + (chat.handle === otherHandle ? ' active' : '');
  li.dataset.handle = chat.handle;
  const meta = chat.lastAt ? timeShort(chat.lastAt) : 'new';
  li.innerHTML = `<span class="handle">@${esc(chat.handle)}</span><span class="meta">${esc(meta)}</span>`;
  return li;
}

function makeUserItem(user) {
  const li = document.createElement('li');
  li.className = 'chat-item' + (user.handle === otherHandle ? ' active' : '');
  li.dataset.handle = user.handle;
  const tag = chats.has(user.handle) ? '' : '<span class="new-tag">start</span>';
  li.innerHTML = `<span class="handle">@${esc(user.handle)}</span>${tag}`;
  return li;
}

async function openChat(handle) {
  if (!handle) return;
  otherHandle = handle;
  conversationTitle.textContent = `@${handle}`;
  lastId = 0;
  elsById.clear();
  pendingIds.clear();
  setMessagesPlaceholder('No messages yet');
  setComposerEnabled(true);
  hideBanner();
  renderSidebar();
  messageInput.focus();
  await poll();
  startPolling();
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
async function poll() {
  if (!otherHandle) return;
  let rows;
  try {
    rows = await api(
      `/api/messages?sender=${encodeURIComponent(myHandle)}&recipient=${encodeURIComponent(otherHandle)}`
    );
    hideBanner();
  } catch (err) {
    showBanner('Unable to read the database: ' + err.message);
    return;
  }
  if (rows.length) {
    const placeholder = messagesBox.querySelector('.placeholder');
    if (placeholder) placeholder.remove();
  }
  for (const row of rows) {
    if (row.id <= lastId) continue;
    lastId = row.id;
    // If it was already shown optimistically on send, only reposition it in order.
    if (pendingIds.has(row.id)) {
      pendingIds.delete(row.id);
      messagesBox.appendChild(elsById.get(row.id));
      continue;
    }
    // 1) Initial render of the new message with the "Not verified" label.
    const el = renderRow(row, 'Not verified', 'info', '...');
    elsById.set(row.id, el);
    // 2) Decrypt to show the plain text (never the ciphertext).
    resolveText(el, row).then(() => {
      // 3) Verify integrity; if valid:true the label changes.
      return resolveStatus(el, row);
    });
  }
  // Keep the sidebar fresh so new conversations/incoming chats show up.
  loadConversations();
}

function renderRow(row, label, cls, text) {
  const el = document.createElement('div');
  const mine = row.sender === myHandle;
  el.className = 'message' + (mine ? ' mine' : '');
  const who = mine ? 'You' : '@' + row.sender;
  const when = new Date(row.created_at).toLocaleTimeString();
  el.innerHTML =
    `<span class="sender">${esc(who)}</span>` +
    `<span class="time">${esc(when)}</span>` +
    `<div class="text">${esc(text)}</div>` +
    `<div class="status ${cls}">${esc(label)}</div>`;
  messagesBox.append(el); // newest at the bottom
  messagesBox.scrollTop = messagesBox.scrollHeight; // keep the latest message visible
  return el;
}

async function resolveText(el, row) {
  try {
    const dec = await api('/api/decrypt', {
      method: 'POST',
      body: JSON.stringify({ ciphertext: row.ciphertext }),
    });
    el.querySelector('.text').textContent = dec.plaintext;
  } catch (err) {
    // If decryption fails, the status label is also marked as an error.
    el.querySelector('.text').textContent = '[Unable to decrypt]';
    el.querySelector('.status').textContent = 'Unable to decrypt';
    el.querySelector('.status').className = 'status error';
  }
}

async function resolveStatus(el, row) {
  const statusEl = el.querySelector('.status');
  try {
    await sleep(600); // pause so "Not verified" -> "Message verified" can be seen
    const ver = await api('/api/verify', {
      method: 'POST',
      body: JSON.stringify({ ciphertext: row.ciphertext, signature: row.signature }),
    });
    if (ver.valid) {
      statusEl.textContent = 'Message verified';
      statusEl.className = 'status verified';
    } else {
      statusEl.textContent = 'Not verified';
      statusEl.className = 'status';
    }
  } catch (err) {
    statusEl.textContent = 'Verification unavailable';
    statusEl.className = 'status error';
  }
}

async function send(ev) {
  ev.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !otherHandle) return;
  try {
    const result = await api('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ sender: myHandle, recipient: otherHandle, text }),
    });
    messageInput.value = '';
    // Optimistic render: the message appears NOW, without waiting for polling.
    const row = {
      id: result.id,
      sender: myHandle,
      recipient: otherHandle,
      ciphertext: result.ciphertext,
      signature: result.signature,
      created_at: result.created_at,
    };
    const el = renderRow(row, 'Not verified', 'info', text);
    elsById.set(row.id, el);
    pendingIds.add(row.id);
    resolveText(el, row);
    resolveStatus(el, row);
    // Move/keep this conversation at the top of the sidebar.
    upsertChat(otherHandle, displayNameFor(otherHandle), row.created_at);
    renderSidebar();
  } catch (err) {
    showBanner('Unable to send: ' + err.message);
  }
}

function startPolling() {
  stopPolling();
  polling = setInterval(poll, POLL_MS);
}

function stopPolling() {
  if (polling) {
    clearInterval(polling);
    polling = null;
  }
}

function logout() {
  stopPolling();
  otherHandle = '';
  myHandle = '';
  sessionStorage.removeItem('myHandle');
  lastId = 0;
  elsById.clear();
  pendingIds.clear();
  chats.clear();
  loginUsername.value = '';
  loginPassword.value = '';
  hideLoginError();
  hideBanner();
  chatScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
loginForm.addEventListener('submit', login);
messageForm.addEventListener('submit', send);
logoutBtn.addEventListener('click', () => logoutModal.classList.remove('hidden'));
logoutCancel.addEventListener('click', () => logoutModal.classList.add('hidden'));
logoutConfirm.addEventListener('click', () => {
  logoutModal.classList.add('hidden');
  logout();
});
logoutModal.addEventListener('click', (ev) => {
  if (ev.target === logoutModal) logoutModal.classList.add('hidden');
});
chatSearch.addEventListener('input', renderSidebar);
toggleSidebar.addEventListener('click', () => {
  chatScreen.classList.toggle('collapsed');
  positionToggle();
});
window.addEventListener('resize', positionToggle);
chatList.addEventListener('click', (ev) => {
  const li = ev.target.closest('.chat-item');
  if (!li) return;
  const handle = li.dataset.handle;
  if (!chats.has(handle)) upsertChat(handle, displayNameFor(handle));
  chatSearch.value = '';
  openChat(handle);
});

// Auto-hide scrollbar: show it while scrolling, hide 1500ms after stopping.
let scrollTimer = null;
messagesBox.addEventListener('scroll', () => {
  messagesBox.classList.add('scrollbar-active');
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => messagesBox.classList.remove('scrollbar-active'), 1500);
});

// If the user refreshed the page, restore the session from sessionStorage.
if (myHandle) {
  enterChatScreen();
}
