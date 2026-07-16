/**
 * GrabixPro Extension Popup Script
 * ==================================
 * Controls the popup UI — checks native host connection,
 * shows current tab info, and enables one-click download.
 */

// Prefer `browser`: in Firefox only that namespace returns promises, and the
// awaits below (tabs.query, executeScript, sendMessage) depend on that. In
// Chrome, `browser` is undefined and `chrome` is already promise-based.
const browserApi = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge   = document.getElementById('status-badge');
  const statusText    = document.getElementById('status-text');
  const statusCard    = document.getElementById('status-card');
  const statusIcon    = document.getElementById('status-icon');
  const statusMessage = document.getElementById('status-message');
  const statusDetail  = document.getElementById('status-detail');
  const pageInfo      = document.getElementById('page-info');
  const pageTitle     = document.getElementById('page-title');
  const pageUrl       = document.getElementById('page-url');
  const downloadBtn   = document.getElementById('download-btn');
  const downloadText  = document.getElementById('download-btn-text');
  const sendBtn       = document.getElementById('send-btn');
  const resolutionSel = document.getElementById('resolution-select');
  const versionLabel  = document.getElementById('version-label');
  const helpLink      = document.getElementById('help-link');
  const fabToggle     = document.getElementById('fab-toggle');

  // ---------- Load Settings ----------

  // Promise style, not a callback: the form both Firefox and Chrome accept.
  browserApi.storage.local.get({ showFAB: true }).then((result) => {
    fabToggle.checked = result.showFAB;
  });

  fabToggle.addEventListener('change', () => {
    browserApi.storage.local.set({ showFAB: fabToggle.checked });
  });

  // Set version
  const manifest = browserApi.runtime.getManifest();
  versionLabel.textContent = `v${manifest.version}`;

  // Help link opens setup instructions
  helpLink.addEventListener('click', (e) => {
    e.preventDefault();
    browserApi.tabs.create({
      url: 'https://github.com/engrsyedzain/Grabix-Pro-Desktop'
    });
    window.close();
  });

  // ---------- Check Connection ----------

  let currentTab = null;
  let isConnected = false;
  // Firefox MV3 treats host_permissions as OPTIONAL: they are granted from the
  // install prompt, so an add-on loaded via about:debugging (no prompt) - or one
  // whose access a user revoked - has none. Without host access `tabs.query`
  // omits `url`, so the extension cannot see which video to download.
  // Chrome grants host_permissions at install, so this stays false there.
  let needsHostAccess = false;

  /**
   * Ask for the host permissions the manifest already declares. Must be called
   * from a click: Firefox only allows permissions.request() during a user gesture.
   */
  async function requestHostAccess() {
    const origins = browserApi.runtime.getManifest().host_permissions || [];
    try {
      const granted = await browserApi.permissions.request({ origins });
      if (granted) {
        // Re-run the popup from the top, now that the tab URL is readable.
        window.location.reload();
        return;
      }
      statusDetail.textContent = 'Access denied. Grabix cannot read the page URL.';
    } catch (e) {
      statusDetail.textContent = `Could not request access: ${e.message}`;
    }
  }

  /**
   * Check if current tab has video content.
   */
  async function checkVideoContent(tab) {
    if (!tab?.url) return false;
    
    // Platform checks
    const url = tab.url.toLowerCase();
    const isVideoPlatform = url.includes('youtube.com') || url.includes('youtu.be') || 
                           url.includes('vimeo.com') || url.includes('twitter.com') || 
                           url.includes('x.com') || url.includes('instagram.com') || 
                           url.includes('tiktok.com') || url.includes('dailymotion.com') ||
                           url.includes('facebook.com') || url.includes('twitch.tv');
    
    if (isVideoPlatform) return true;

    // Attempt to check for video tags via scripting
    try {
      const results = await browserApi.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.getElementsByTagName('video').length > 0
      });
      return results[0]?.result || false;
    } catch (e) {
      // If scripting fails (e.g. on chrome:// pages), fallback to false
      return false;
    }
  }

  try {
    // Get the active tab
    const [tab] = await browserApi.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    // A tab with no `url` means no host access, not a missing tab.
    needsHostAccess = !!tab && !tab.url;

    // Show page info if it's a valid URL
    if (tab?.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
      pageInfo.classList.remove('hidden');
      pageTitle.textContent = tab.title || 'Untitled Page';
      pageUrl.textContent = tab.url;
    }
  } catch (e) {
    console.error('[GrabixPro] Failed to get tab:', e);
  }

  // Check native host connection
  try {
    const response = await browserApi.runtime.sendMessage({ action: 'checkConnection' });

    if (response?.connected) {
      isConnected = true;

      // Update badge
      statusBadge.className = 'status-badge status-connected';
      statusText.textContent = 'Connected';

      // Update card
      statusCard.className = 'status-card card-connected';
      statusIcon.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
             width="28" height="28">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      `;
      statusMessage.textContent = 'GrabixPro is ready';
      statusDetail.textContent = response.version
        ? `Native host v${response.version}`
        : 'Native host connected';

      if (needsHostAccess) {
        // Don't call this "no video detected" - it isn't. The page may well be a
        // video; we simply aren't allowed to look. Offer the one action that helps.
        statusText.textContent = 'Access needed';
        statusMessage.textContent = 'Grabix needs access to this site';
        statusDetail.textContent = 'Firefox has not granted site access yet. Click Grant access to enable downloads.';
        downloadText.textContent = 'Grant access';
        downloadBtn.disabled = false;
        sendBtn.disabled = true;
      } else {
        // Enable buttons if we have a valid page and video content
        const hasVideo = await checkVideoContent(currentTab);
        if (hasVideo) {
          downloadBtn.disabled = false;
          sendBtn.disabled = false;
        } else {
          downloadBtn.disabled = true;
          sendBtn.disabled = true;
          statusText.textContent = 'No video detected';
          statusMessage.textContent = 'No video detected on page';
          statusDetail.textContent = 'Open a video page to enable downloading';
        }
      }
    } else {
      setDisconnected(response?.error || 'Native host not found');
    }
  } catch (e) {
    setDisconnected(e.message || 'Connection check failed');
  }

  function setDisconnected(errorMsg) {
    isConnected = false;

    statusBadge.className = 'status-badge status-disconnected';
    statusText.textContent = 'Disconnected';

    statusCard.className = 'status-card card-disconnected';
    statusIcon.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
           width="28" height="28">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
    `;
    statusMessage.textContent = 'GrabixPro not connected';
    statusDetail.textContent = errorMsg.includes('not found')
      ? 'Open GrabixPro → Settings → Register Host'
      : errorMsg;

    downloadBtn.disabled = true;
    sendBtn.disabled = true;
  }

  // ---------- Download Button ----------

  downloadBtn.addEventListener('click', async () => {
    // Doubles as the "Grant access" button when Firefox has withheld host access.
    if (needsHostAccess) {
      await requestHostAccess();
      return;
    }
    sendDownload('silent');
  });

  sendBtn.addEventListener('click', async () => {
    sendDownload('active');
  });

  async function sendDownload(mode) {
    // Say why nothing happened. This used to `return` in silence, so a popup that
    // read "Connected" would ignore the button with no explanation anywhere.
    if (!isConnected) {
      statusDetail.textContent = 'Not connected to GrabixPro. Is the app running?';
      return;
    }
    if (!currentTab?.url) {
      needsHostAccess = true;
      statusDetail.textContent = 'Grabix cannot read this page URL. Click Grant access.';
      downloadText.textContent = 'Grant access';
      downloadBtn.disabled = false;
      return;
    }

    const isSilent = mode === 'silent';
    
    if (isSilent) {
      downloadBtn.classList.add('btn-loading');
      downloadText.textContent = 'Sending...';
    } else {
      sendBtn.textContent = 'Launching...';
    }

    try {
      const response = await browserApi.runtime.sendMessage({
        action: 'download',
        url: currentTab.url,
        title: currentTab.title || '',
        resolution: resolutionSel.value,
        mode: mode
      });

      if (response?.success) {
        if (isSilent) {
          downloadBtn.classList.remove('btn-loading');
          downloadBtn.classList.add('btn-success');
          downloadText.textContent = 'Sent!';
        } else {
          sendBtn.textContent = 'Launched!';
        }
        setTimeout(() => window.close(), 1500);
      } else {
        if (isSilent) {
          downloadBtn.classList.remove('btn-loading');
          downloadBtn.classList.add('btn-error');
          downloadText.textContent = 'Failed';
          setTimeout(() => {
            downloadBtn.classList.remove('btn-error');
            downloadText.textContent = 'Download';
          }, 3000);
        } else {
          sendBtn.textContent = 'Send to Grabix';
        }
      }
    } catch (e) {
      if (isSilent) {
        downloadBtn.classList.remove('btn-loading');
        downloadBtn.classList.add('btn-error');
        downloadText.textContent = 'Error';
        setTimeout(() => {
          downloadBtn.classList.remove('btn-error');
          downloadText.textContent = 'Download';
        }, 3000);
      } else {
        sendBtn.textContent = 'Send to Grabix';
      }
    }
  }
});
