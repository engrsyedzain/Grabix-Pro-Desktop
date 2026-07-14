/**
 * GrabixPro Background Service Worker
 * ====================================
 * Central message router for the browser extension.
 * Handles communication between content scripts, popup, and the native host.
 */

const NATIVE_HOST_NAME = 'grabix_pro_host';

// ---------- Connection State ----------
let isConnected = false;
let lastError = '';

// ---------- Native Messaging ----------

/**
 * Send a message to the native host and return the response.
 * Uses chrome.runtime.sendNativeMessage (one-shot messaging).
 */
const browserApi = typeof browser !== 'undefined' ? browser : chrome;

function sendToNativeHost(message) {
  return new Promise((resolve, reject) => {
    browserApi.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
      const error = browserApi.runtime.lastError;
      if (error) {
        console.error('[GrabixPro] Native messaging error:', error.message);
        reject(new Error(error.message));
      } else {
        console.log('[GrabixPro] Native host response:', response);
        resolve(response);
      }
    });
  });
}

/**
 * Check if the native host is reachable by sending a ping.
 */
async function checkConnection() {
  try {
    const response = await sendToNativeHost({ action: 'ping' });
    isConnected = response && response.status === 'ok';
    lastError = '';
    return { connected: true, version: response?.version || 'unknown' };
  } catch (e) {
    isConnected = false;
    lastError = e.message;
    return { connected: false, error: e.message };
  }
}

/**
 * Send a video URL to the native host for download.
 */
async function sendDownloadRequest(url, title = '', resolution = '720p', mode = 'silent') {
  try {
    const response = await sendToNativeHost({ url, title, resolution, mode });
    
    if (response?.status === 'ok') {
      const isSilent = mode === 'silent';
      const notificationTitle = isSilent ? 'GrabixPro Background' : 'GrabixPro Active';
      const notificationMessage = isSilent 
        ? `Added to queue: ${title || url.substring(0, 50)}...`
        : `Sent for analysis: ${title || url.substring(0, 50)}...`;

      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: notificationTitle,
        message: notificationMessage,
        priority: 1
      });
      return { success: true, response };
    } else {
      throw new Error(response?.message || 'Unknown error from native host');
    }
  } catch (e) {
    // Show error notification
    chrome.notifications.create({
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle async responses
  const handleAsync = async () => {
    switch (message.action) {
      case 'download': {
        const result = await sendDownloadRequest(message.url, message.title, message.resolution, message.mode);
        sendResponse(result);
        break;
      }

      case 'checkConnection': {
        const status = await checkConnection();
        sendResponse(status);
        break;
      }

      case 'getStatus': {
        sendResponse({
          connected: isConnected,
          lastError: lastError
        });
        break;
      }

      default:
        sendResponse({ error: 'Unknown action' });
    }
  };

  handleAsync();
  return true; // Keep the message channel open for async response
});

// ---------- Toolbar Icon Click (Fallback) ----------

/**
 * If popup fails to open (e.g., on restricted pages), the toolbar click
 * falls back to sending the current tab URL directly.
 * Note: With default_popup set, this won't fire normally. It's a safety net.
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
    await sendDownloadRequest(tab.url, tab.title || '', '720p', 'silent');
  } else {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'GrabixPro',
      message: 'Cannot download from this page. Navigate to a video page first.'
    });
  }
});

// ---------- Extension Install / Update ----------

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[GrabixPro] Extension installed. Checking native host connection...');
    checkConnection();
  } else if (details.reason === 'update') {
    console.log(`[GrabixPro] Extension updated to v${chrome.runtime.getManifest().version}`);
  }
});

// ---------- Badge Updates ----------

/**
 * Update the extension badge to reflect connection status.
 */
async function updateBadge() {
  const status = await checkConnection();
  if (status.connected) {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
  } else {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  }
}

// Check connection on service worker start
updateBadge();
