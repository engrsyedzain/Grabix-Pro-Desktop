/**
 * GrabixPro Background Service Worker
 * ====================================
 * Central message router for the browser extension.
 * Handles communication between content scripts, popup, and the native host.
 *
 * Chrome runs this as an MV3 service worker; Firefox runs it as an event page
 * (see the dual background key in manifest.json). Both are ephemeral: the runtime
 * is torn down after ~30s idle and restarted on the next event, so nothing here
 * may keep state in module scope - it lives in storage.session instead.
 */

const NATIVE_HOST_NAME = 'grabix_pro_host';

// Prefer `browser`: in Firefox only that namespace returns promises, while
// `chrome` is a callback-style shim. In Chrome, `browser` is undefined and
// `chrome` is already promise-based.
const browserApi = typeof browser !== 'undefined' ? browser : chrome;

// ---------- Connection State ----------

/**
 * Connection state has to outlive the worker, so it lives in session storage
 * (cleared on browser restart, never written to disk). Module-level globals
 * silently reset to their defaults every time the worker is respawned, which
 * made getStatus report "disconnected" regardless of reality.
 */
const DEFAULT_STATE = { connected: false, lastError: '', version: '' };

async function readState() {
  try {
    const stored = await browserApi.storage.session.get({ connectionState: DEFAULT_STATE });
    return stored.connectionState || DEFAULT_STATE;
  } catch (e) {
    return DEFAULT_STATE;
  }
}

async function writeState(state) {
  try {
    await browserApi.storage.session.set({ connectionState: state });
  } catch (e) {
    console.warn('[GrabixPro] Could not persist connection state:', e);
  }
}

// ---------- Native Messaging ----------

/**
 * Send a message to the native host and return the response.
 * Uses sendNativeMessage (one-shot messaging: each call spawns a host process,
 * which reads one message, replies, and exits).
 */
function sendToNativeHost(message) {
  // Firefox's browser.* returns a promise and rejects on failure; it does not
  // take a callback. Chrome's chrome.* reports failure via lastError instead.
  if (typeof browser !== 'undefined') {
    return browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, message);
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        console.error('[GrabixPro] Native messaging error:', error.message);
        reject(new Error(error.message));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Check if the native host is reachable by sending a ping, and persist the result.
 */
async function checkConnection() {
  let state;
  try {
    const response = await sendToNativeHost({ action: 'ping' });
    // A reachable host that answers with anything other than ok is NOT connected.
    // This used to return `connected: true` unconditionally, so an error reply
    // still showed a green badge and "GrabixPro is ready".
    const ok = response?.status === 'ok';
    state = {
      connected: ok,
      lastError: ok ? '' : (response?.message || 'Unexpected response from native host'),
      version: response?.version || '',
    };
  } catch (e) {
    state = { connected: false, lastError: e.message, version: '' };
  }

  await writeState(state);
  await applyBadge(state.connected);

  // `error` is what the popup reads; keep the shape it expects.
  return { connected: state.connected, version: state.version || 'unknown', error: state.lastError };
}

/**
 * Send a video URL to the native host for download.
 */
async function sendDownloadRequest(url, title = '', resolution = '720p', mode = 'silent') {
  try {
    const response = await sendToNativeHost({ url, title, resolution, mode });

    if (response?.status === 'ok') {
      // No notification on success: the app raises its own "Download started"
      // card the moment it accepts the request, so a browser toast here fired at
      // the same instant and said the same thing twice.
      //
      // The error paths below stay: they report the app being missing or the
      // page being unsupported, and in both cases the app is not running to
      // raise a card of its own. Removing them would make those failures silent.
      return { success: true, response };
    } else {
      throw new Error(response?.message || 'Unknown error from native host');
    }
  } catch (e) {
    // Show error notification
    browserApi.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'GrabixPro Error',
      message: e.message.includes('not found')
        ? 'GrabixPro is not installed or native host is not registered. Open GrabixPro Settings to set up.'
        : `Error: ${e.message}`,
      priority: 2
    });
    return { success: false, error: e.message };
  }
}

// ---------- Message Handling ----------

/**
 * Listen for messages from content scripts and popup.
 */
async function handleMessage(message) {
  switch (message.action) {
    case 'download':
      return await sendDownloadRequest(message.url, message.title, message.resolution, message.mode);

    case 'checkConnection':
      return await checkConnection();

    case 'getStatus': {
      const state = await readState();
      return { connected: state.connected, lastError: state.lastError };
    }

    default:
      return { error: 'Unknown action' };
  }
}

browserApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handled = handleMessage(message);

  // The two browsers want opposite things here, and getting it wrong means the
  // sender's promise never settles:
  //   Firefox - reply by returning a promise from the listener.
  //   Chrome  - ignores a returned promise; it needs sendResponse plus a literal
  //             `true` to hold the channel open.
  if (typeof browser !== 'undefined') {
    return handled;
  }

  handled.then(sendResponse);
  return true;
});

// ---------- Toolbar Icon Click (Fallback) ----------

/**
 * If popup fails to open (e.g., on restricted pages), the toolbar click
 * falls back to sending the current tab URL directly.
 * Note: With default_popup set, this won't fire normally. It's a safety net.
 */
browserApi.action.onClicked.addListener(async (tab) => {
  if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
    await sendDownloadRequest(tab.url, tab.title || '', '720p', 'silent');
  } else {
    browserApi.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'GrabixPro',
      message: 'Cannot download from this page. Navigate to a video page first.'
    });
  }
});

// ---------- Extension Install / Update ----------

browserApi.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[GrabixPro] Extension installed. Checking native host connection...');
    checkConnection();
  } else if (details.reason === 'update') {
    console.log(`[GrabixPro] Extension updated to v${browserApi.runtime.getManifest().version}`);
  }
});

// ---------- Badge Updates ----------

/**
 * Reflect connection status on the toolbar badge.
 */
async function applyBadge(connected) {
  try {
    await browserApi.action.setBadgeText({ text: connected ? '' : '!' });
    await browserApi.action.setBadgeBackgroundColor({ color: connected ? '#22c55e' : '#ef4444' });
  } catch (e) {
    console.warn('[GrabixPro] Could not update badge:', e);
  }
}

/**
 * Paint the badge from the last known state immediately on wake, then re-ping.
 * Without the cached read the badge would flash its default until the ping
 * round-trips through a freshly spawned host process.
 */
async function restoreBadgeThenRefresh() {
  const state = await readState();
  await applyBadge(state.connected);
  await checkConnection();
}

// Runs on every worker/event-page startup.
restoreBadgeThenRefresh();
