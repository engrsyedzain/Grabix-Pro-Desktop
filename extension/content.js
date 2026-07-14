/**
 * GrabixPro Content Script
 * =========================
 * Injected on supported video platforms. Detects the video context
 * and injects a floating download button that sends the URL to the
 * background service worker → native host → GrabixPro app.
 */

(() => {
  // Prevent double-injection (SPA navigation can re-trigger)
  if (document.getElementById('grabixpro-fab')) return;

  // ---------- Platform Detection ----------

  const PLATFORM_CONFIG = {
    'youtube.com': {
      name: 'YouTube',
      isVideoPage: () => /\/watch\?/.test(location.href) || /\/shorts\//.test(location.href),
      getTitle: () => document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent
        || document.querySelector('#title h1')?.textContent
        || document.title,
      // YouTube is an SPA — watch for URL changes
      observeNavigation: true,
      anchorSelector: '#above-the-fold, #player, ytd-watch-flexy',
    },
    'vimeo.com': {
      name: 'Vimeo',
      isVideoPage: () => /\/\d+/.test(location.pathname),
      getTitle: () => document.querySelector('h1')?.textContent || document.title,
      observeNavigation: false,
      anchorSelector: '.player_container, .clip_main',
    },
    'dailymotion.com': {
      name: 'Dailymotion',
      isVideoPage: () => /\/video\//.test(location.pathname),
      getTitle: () => document.querySelector('h1')?.textContent || document.title,
      observeNavigation: false,
      anchorSelector: '.Player',
    },
    'facebook.com': {
      name: 'Facebook',
      isVideoPage: () => {
        const isReel = /\/reels\/|\/reel\//.test(location.pathname);
        const isVideo = /\/videos\/|\/watch/.test(location.pathname);
        // Also check for presence of video elements if URL is ambiguous
        const hasVideo = document.querySelector('video') !== null;
        return isReel || isVideo || (hasVideo && !location.pathname.includes('/messages/'));
      },
      getTitle: () => document.title,
      observeNavigation: true,
      anchorSelector: '[data-pagelet="WatchPermalinkVideo"], .x1hc1f62, [role="main"] video',
    },
    'instagram.com': {
      name: 'Instagram',
      isVideoPage: () => /\/reel\/|\/p\//.test(location.pathname),
      getTitle: () => document.title,
      observeNavigation: true,
      anchorSelector: 'article',
    },
    'x.com': {
      name: 'X (Twitter)',
      isVideoPage: () => /\/status\//.test(location.pathname),
      getTitle: () => document.title,
      observeNavigation: true,
      anchorSelector: 'article[data-testid="tweet"]',
    },
    'twitter.com': {
      name: 'Twitter',
      isVideoPage: () => /\/status\//.test(location.pathname),
      getTitle: () => document.title,
      observeNavigation: true,
      anchorSelector: 'article[data-testid="tweet"]',
    },
    'twitch.tv': {
      name: 'Twitch',
      isVideoPage: () => /\/videos\//.test(location.pathname),
      getTitle: () => document.querySelector('h2[data-a-target="stream-title"]')?.textContent || document.title,
      observeNavigation: true,
      anchorSelector: '.video-player',
    },
    'bilibili.com': {
      name: 'Bilibili',
      isVideoPage: () => /\/video\//.test(location.pathname),
      getTitle: () => document.querySelector('h1.video-title')?.textContent || document.title,
      observeNavigation: true,
      anchorSelector: '#playerWrap',
    },
    'tiktok.com': {
      name: 'TikTok',
      isVideoPage: () => /\/@[^/]+\/video\//.test(location.pathname) || /\/video\//.test(location.pathname),
      getTitle: () => document.title,
      observeNavigation: true,
      anchorSelector: '#app',
    },
  };

  /**
   * Determine which platform we're on.
   */
  function detectPlatform() {
    const hostname = location.hostname.replace(/^(www\.|m\.)/, '');
    return PLATFORM_CONFIG[hostname] || null;
  }

  // ---------- Settings Handling ----------

  let showFAB = true;

  // Initial load of settings
  chrome.storage.local.get({ showFAB: true }, (result) => {
    showFAB = result.showFAB;
    checkAndInject();
  });

  // Listen for changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.showFAB) {
      showFAB = changes.showFAB.newValue;
      checkAndInject();
    }
  });

  // ---------- UI Injection ----------

  const GRABIX_ICON_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
         width="22" height="22">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  `;

  let fab = null;
  let tooltip = null;

  /**
   * Create and inject the floating download button.
   */
  function injectFAB(platform) {
    // Remove existing FAB if present
    removeFAB();

    fab = document.createElement('div');
    fab.id = 'grabixpro-fab';
    fab.innerHTML = GRABIX_ICON_SVG;
    fab.title = `Download with GrabixPro`;
    fab.setAttribute('role', 'button');
    fab.setAttribute('tabindex', '0');
    fab.setAttribute('aria-label', `Download this ${platform.name} video with GrabixPro`);

    // Tooltip
    tooltip = document.createElement('div');
    tooltip.id = 'grabixpro-tooltip';
    tooltip.textContent = `Download with GrabixPro`;

    fab.addEventListener('mouseenter', () => {
      tooltip.classList.add('grabixpro-tooltip-visible');
    });
    fab.addEventListener('mouseleave', () => {
      tooltip.classList.remove('grabixpro-tooltip-visible');
    });

    // Click handler
    fab.addEventListener('click', () => handleDownloadClick(platform));
    fab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleDownloadClick(platform);
      }
    });

    document.body.appendChild(fab);
    document.body.appendChild(tooltip);
  }

  /**
   * Remove the floating download button.
   */
  function removeFAB() {
    const existingFab = document.getElementById('grabixpro-fab');
    const existingTooltip = document.getElementById('grabixpro-tooltip');
    if (existingFab) existingFab.remove();
    if (existingTooltip) existingTooltip.remove();
    fab = null;
    tooltip = null;
  }

  // ---------- Download Logic ----------

  let isProcessing = false;

  /**
   * Handle the download button click.
   */
  async function handleDownloadClick(platform) {
    if (isProcessing) return;
    isProcessing = true;

    // Visual feedback
    fab.classList.add('grabixpro-fab-loading');

    const pageUrl = location.href;
    const pageTitle = platform.getTitle() || document.title || '';

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'download',
        url: pageUrl,
        title: pageTitle.trim(),
        resolution: '720p',
        mode: 'silent',
      });

      if (response?.success) {
        fab.classList.remove('grabixpro-fab-loading');
        fab.classList.add('grabixpro-fab-success');
        setTimeout(() => {
          fab?.classList.remove('grabixpro-fab-success');
        }, 2500);
      } else {
        fab.classList.remove('grabixpro-fab-loading');
        fab.classList.add('grabixpro-fab-error');
        setTimeout(() => {
          fab?.classList.remove('grabixpro-fab-error');
        }, 3000);
      }
    } catch (e) {
      console.error('[GrabixPro] Download request failed:', e);
      fab.classList.remove('grabixpro-fab-loading');
      fab.classList.add('grabixpro-fab-error');
      setTimeout(() => {
        fab?.classList.remove('grabixpro-fab-error');
      }, 3000);
    } finally {
      isProcessing = false;
    }
  }

  // ---------- Initialization ----------

  const platform = detectPlatform();
  if (!platform) return;

  /**
   * Check the page and inject/remove the FAB as needed.
   */
  function checkAndInject() {
    if (showFAB && platform.isVideoPage()) {
      if (!document.getElementById('grabixpro-fab')) {
        injectFAB(platform);
      }
    } else {
      removeFAB();
    }
  }

  // Initial check (with a small delay for SPA hydration and storage load)
  setTimeout(checkAndInject, 1500);
  // Second check for slow loading Reels/Videos
  setTimeout(checkAndInject, 3500);

  // YouTube and other SPAs: observe URL changes
  if (platform.observeNavigation) {
    let lastUrl = location.href;
    const urlObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Check multiple times as the page hydrates
        setTimeout(checkAndInject, 1000);
        setTimeout(checkAndInject, 2500);
        setTimeout(checkAndInject, 4000);
      }
    });
    urlObserver.observe(document.body, { childList: true, subtree: true });

    // Also listen for popstate (back/forward navigation)
    window.addEventListener('popstate', () => {
      setTimeout(checkAndInject, 1500);
    });
  }
})();
