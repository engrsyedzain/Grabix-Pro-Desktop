import { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import StepsIndicator from './components/StepsIndicator';
import Sidebar from './components/Sidebar';
import PlaylistStep from './components/PlaylistStep';
import FormatStep from './components/FormatStep';
import DestinationStep from './components/DestinationStep';
import DownloadStep from './components/DownloadStep';
import SettingsModal from './components/SettingsModal';
import { ThemeProvider } from './hooks/useTheme';
import { useToast } from './hooks/useToast';
import { ChevronLeft, ChevronRight, Search, X, RotateCcw, CloudDownload, Zap } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import DownloadedVideos from './components/DownloadedVideos';
import { VideoInfo, DownloadProgress, Settings, LiveProgress, HistoryEntry } from './types';

const STEPS = [
  { id: 1, label: 'URL' },
  { id: 2, label: 'Format' },
  { id: 3, label: 'Destination' },
  { id: 4, label: 'Download' },
];

interface DownloadArgs {
  // Index signature so this satisfies Tauri's InvokeArgs.
  [key: string]: unknown;
  id: string;
  url: string;
  formatId: string;
  savePath: string;
  dlSubtitles: boolean;
  title: string | null;
  /** `*START-END` in seconds, or null for the whole video. */
  section: string | null;
}

function App() {
  const { toast, confirm } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [activeView, setActiveView] = useState<'main' | 'history'>('main');
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Form State
  const [url, setUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const analysisCancelled = useRef(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [isPlaylist, setIsPlaylist] = useState(false);
  const [selectedVideoUrls, setSelectedVideoUrls] = useState<string[]>([]);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const downloadCancelled = useRef(false);

  // Transient per-URL progress. Kept out of `settings` on purpose — see the
  // save-settings effect below.
  const [liveProgress, setLiveProgress] = useState<Record<string, LiveProgress>>({});
  const [queue, setQueue] = useState({ total: 0, done: 0 });

  // Clip trimming (single videos only).
  const [trimEnabled, setTrimEnabled] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  // Ids the user cancelled, so a worker doesn't log the killed job as "finished".
  const cancelledIds = useRef<Set<string>>(new Set());
  const downloadSeq = useRef(0);
  const nextDownloadId = () => `dl_${Date.now()}_${downloadSeq.current++}`;

  // The event listeners below are registered once (deps: []), so they'd capture a
  // stale handleAnalyze. Reach it through a ref instead.
  const handleAnalyzeRef = useRef<((target?: string) => void) | undefined>(undefined);
  const urlRef = useRef('');

  // --- shared concurrency limit -------------------------------------------
  // Every download goes through runDownload(), so the user's concurrency setting
  // actually holds. The extension's silent-download path used to invoke
  // start_download directly, bypassing the queue entirely — clicking Download on
  // five tabs spawned five simultaneous yt-dlp processes regardless of the limit.
  // (concurrencyRef is kept in sync further down, once `settings` exists.)
  const inFlight = useRef(0);
  const waiters = useRef<Array<() => void>>([]);
  const concurrencyRef = useRef(1);

  const runDownloadRef = useRef<((args: DownloadArgs) => Promise<void>) | undefined>(undefined);

  const runDownload = async (args: DownloadArgs) => {
    while (inFlight.current >= concurrencyRef.current) {
      await new Promise<void>(resolve => waiters.current.push(resolve));
    }
    inFlight.current++;
    try {
      await invoke('start_download', args);
    } finally {
      inFlight.current = Math.max(0, inFlight.current - 1);
      waiters.current.shift()?.();
    }
  };

  // Settings State
  const [settings, setSettings] = useState<Settings>({
    autoAdvance: true,
    autoPaste: false,
    showActivity: true,
    dlSubtitles: false,
    showThumbnail: true,
    autoOpenFolder: true,
    concurrentDownloads: 1,
    defaultResolution: 'custom',
    history: [],
    savePath: '',
    playlistDownload: false,
    cookiesFromBrowser: '',
    limitRate: '',
  });
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);

  // Load settings from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const savedSettings = await invoke<Settings>('load_settings');
        
        // Validate savePath if it exists
        if (savedSettings.savePath) {
          const pathExists = await invoke<boolean>('check_path_exists', { path: savedSettings.savePath });
          if (!pathExists) {
            savedSettings.savePath = '';
            addLog('Saved download path no longer exists. Location cleared.');
          }
        }
        
        setSettings(savedSettings);
        setIsSettingsLoaded(true);
      } catch (e) {
        addLog(`Error loading settings: ${e}`);
        setIsSettingsLoaded(true); // Still mark as loaded to allow saving
      }
    };
    loadSettings();
  }, []);

  // Persist settings, debounced. This used to fire on every settings change —
  // and because live download progress was being written into settings.history,
  // that meant a full serialize + rewrite of settings.json several times a second
  // during a download. Progress now lives in `liveProgress` (never persisted), so
  // this only runs on real preference/history changes; the debounce is belt-and-braces.
  useEffect(() => {
    if (!isSettingsLoaded) return;
    const t = setTimeout(() => {
      invoke('save_settings', { settings }).catch(e => {
        console.error('Failed to save settings:', e);
      });
    }, 400);
    return () => clearTimeout(t);
  }, [settings, isSettingsLoaded]);

  const savePath = settings.savePath;

  const addHistory = (
    title: string,
    videoUrl: string,
    filePath?: string,
    status: string = 'finished',
    id?: string,
  ) => {
    setSettings(prev => {
      const existingIdx = prev.history.findIndex(h => h.url === videoUrl);

      if (existingIdx !== -1) {
        const newHistory = [...prev.history];
        newHistory[existingIdx] = {
          ...newHistory[existingIdx],
          status,
          id: id ?? newHistory[existingIdx].id,
          path: filePath || newHistory[existingIdx].path,
          timestamp: new Date().toISOString()
        };
        return { ...prev, history: newHistory };
      }

      return {
        ...prev,
        history: [{
          id,
          title,
          url: videoUrl,
          timestamp: new Date().toISOString(),
          path: filePath,
          status,
          progress: status === 'finished' ? 100 : 0
        }, ...prev.history].slice(0, 100)
      };
    });
  };

  /** Aggregate view of a multi-item queue. The old Step-4 bar just rendered the
   *  last download-progress event, so with concurrency > 1 every worker clobbered
   *  the same number and the bar jumped between videos. */
  const queueStats = (() => {
    const total = queue.total;
    if (total <= 1) return null;
    const activeFraction = settings.history
      .filter(h => liveProgress[h.url]?.status === 'downloading')
      .reduce((sum, h) => sum + (liveProgress[h.url]?.progress ?? 0) / 100, 0);
    const overall = Math.min(100, ((queue.done + activeFraction) / total) * 100);
    return { total, done: queue.done, overall };
  })();

  /** History with transient progress folded back in for display only. */
  const historyView: HistoryEntry[] = settings.history.map(h => {
    const lp = liveProgress[h.url];
    if (!lp) return h;
    return {
      ...h,
      status: lp.status ?? h.status,
      progress: lp.progress ?? h.progress,
      speed: lp.speed ?? h.speed,
      eta: lp.eta ?? h.eta,
    };
  });

  // Reset the trim window whenever a different video is analysed, and seed the end
  // point at the full duration.
  useEffect(() => {
    setTrimEnabled(false);
    setTrimStart(0);
    setTrimEnd(Math.floor(videoInfo?.duration ?? 0));
  }, [videoInfo?.id, videoInfo?.duration]);

  /** yt-dlp --download-sections value, or null when trimming is off/meaningless. */
  const trimSection = (): string | null => {
    if (!trimEnabled || isPlaylist) return null;
    if (trimEnd <= trimStart) return null;
    return `*${Math.round(trimStart)}-${Math.round(trimEnd)}`;
  };

  /** Quick Grab needs somewhere to put the file and a resolution to pick without asking. */
  const canQuickGrab = !!savePath && settings.defaultResolution !== 'custom';

  /** Maps a stored defaultResolution preference to a yt-dlp format selector. */
  const resolutionToFormatId = (res: string): string => {
    if (res === 'audio-mp3' || res === 'audio_mp3') return 'mp3';
    if (res === 'audio-aac' || res === 'audio_aac') return 'aac_audio';
    if (res.includes('__')) {
      const [resStr, codec] = res.split('__');
      const h = parseInt(resStr);
      if (h) return `bestvideo[height<=${h}]+bestaudio/best__${codec === 'opus' ? 'opus' : 'aac'}`;
    }
    const h = parseInt(res);
    if (h) return `bestvideo[height<=${h}]+bestaudio/best__aac`;
    return 'bestvideo+bestaudio/best';
  };

  /** Re-runs a failed or cancelled download straight from the History list. */
  const retryOne = async (entry: HistoryEntry) => {
    const id = nextDownloadId();
    const formatId = resolutionToFormatId(settings.defaultResolution);
    const target = savePath || '';

    addLog(`Retrying: ${entry.title}`);
    addHistory(entry.title, entry.url, target, 'downloading', id);

    try {
      await runDownload({
        id,
        url: entry.url,
        formatId,
        savePath: target,
        dlSubtitles: settings.dlSubtitles,
        title: entry.title,
        section: null,
      });
      if (cancelledIds.current.has(id)) {
        cancelledIds.current.delete(id);
        return;
      }
      addHistory(entry.title, entry.url, target, 'finished', id);
      toast(`Download complete: ${entry.title}`, 'success');
    } catch (e) {
      addLog(`Retry failed: ${e}`);
      addHistory(entry.title, entry.url, target, 'error', id);
      toast(`Retry failed: ${e}`, 'error');
    }
  };

  /** Cancels one download without disturbing the rest of the queue. */
  const cancelOne = async (entry: HistoryEntry) => {
    if (!entry.id) return;
    cancelledIds.current.add(entry.id);
    try {
      await invoke('cancel_download', { id: entry.id });
      addLog(`Cancelled: ${entry.title}`);
      setLiveProgress(prev => {
        const next = { ...prev };
        delete next[entry.url];
        return next;
      });
      addHistory(entry.title, entry.url, entry.path, 'cancelled', entry.id);
    } catch (e) {
      addLog(`Failed to cancel: ${e}`);
    }
  };

  const removeHistoryEntry = (timestamp: string) => {
    setSettings(prev => ({
      ...prev,
      history: prev.history.filter(h => h.timestamp !== timestamp)
    }));
  };

  const clearHistory = async () => {
    const ok = await confirm({
      title: 'Clear download history?',
      message: 'This removes every entry from your history. The downloaded files themselves are not deleted.',
      confirmLabel: 'Clear history',
      danger: true,
    });
    if (ok) {
      setSettings(prev => ({ ...prev, history: [] }));
      toast('Download history cleared.', 'success');
    }
  };

  const addLog = (message: string) => {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    setLogs(prev => [...prev, `  ${ts}  >  ${message}`]);
  };

  useEffect(() => {
    const handleFocus = async () => {
      if (!settings.autoPaste || currentStep !== 1 || !!url) return;
      
      try {
        const text = await navigator.clipboard.readText();
        if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
          setUrl(text);
          addLog('URL auto-pasted from clipboard.');
        }
      } catch (e) {
        // Clipboard access denied
      }
    };

    // Check on mount and on focus
    handleFocus();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [currentStep, url, settings.autoPaste]);

  // Closing the window hides to the tray rather than quitting (see lib.rs
  // on_window_event). That surprises people, so say it once.
  useEffect(() => {
    if (localStorage.getItem('grabix_tray_hint_shown')) return;
    const t = setTimeout(() => {
      toast(
        'Heads up: closing the window keeps Grabix Pro running in the system tray so downloads finish. Use the tray icon to quit.',
        'info',
      );
      localStorage.setItem('grabix_tray_hint_shown', '1');
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    
    // Auto-register extension on startup to ensure native host is linked
    const autoRegister = async () => {
       try {
         // Use a dummy ID for auto-reg, it will only affect Chrome/Edge 
         // if they are not already set up. Firefox uses hardcoded ID.
         const res = await invoke<string>('setup_browser_extension', { extensionId: 'no_id_provided' });
         console.log('[GrabixPro] Auto-registration:', res);
       } catch (err) {
         console.warn('[GrabixPro] Auto-registration failed (ignore if not admin):', err);
       }
    };
    autoRegister();
  }, []);

  useEffect(() => {
    const unlistenProgress = listen<DownloadProgress>('download-progress', (event) => {
      const payload = event.payload;
      setDownloadProgress(payload);

      // Live progress goes to transient state, NOT into settings. Writing it into
      // settings.history made every progress tick rewrite settings.json on disk.
      if (payload.url) {
        setLiveProgress(prev => ({
          ...prev,
          [payload.url as string]: {
            status: payload.status,
            progress: payload.progress,
            speed: payload.speed,
            eta: payload.eta,
          },
        }));
      }

      if (payload.status === 'finished' || payload.status === 'error') {
        addHistory(payload.title || 'Video', payload.url || '', payload.path, payload.status);
      }

      if (payload.status === 'downloading' && payload.progress !== undefined) {
        const percent = Math.floor(payload.progress);
        if (percent % 10 === 0) { 
           addLog(`[Progress] ${payload.title || 'Video'}: ${percent}%`);
        }
      }

      if (payload.status === 'finished') {
        setIsDownloading(false);
        addLog(`[Success] Download finished: ${payload.title || 'Media'}`);
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("GrabixPro", { body: `Download complete: ${payload.title || 'Media'}` });
        }
      }
    });

    const unlistenLog = listen<string>('download-log', (event) => {
      addLog(event.payload);
    });

    const unlistenDownloadUrl = listen<string>('download-url', (event) => {
      const newUrl = event.payload;
      addLog(`Received URL from extension: ${newUrl}`);
      setUrl(newUrl);
      setActiveView('main');
      setCurrentStep(1);
      // Call the handler directly. This used to reach into the DOM
      // (querySelector('button.bg-grabix-purple'), check textContent === 'Analyze',
      // .click() on a 500ms timer), which made a CSS class load-bearing app logic
      // and silently broke if the button was restyled, relabelled, or slow to mount.
      handleAnalyzeRef.current?.(newUrl);
    });

    const unlistenSilentDownload = listen<string>('silent-download-request', async (event) => {
      try {
        const payload = JSON.parse(event.payload);
        const mode = payload.mode || 'silent';
        const isSilent = mode === 'silent';
        
        addLog(`Received ${mode} download request: ${payload.url}`);

        if (!isSilent) {
           // ACTIVE MODE: Populates URL, Analyzes, and jumps to Download Step
           // RESET UI STATE first to avoid "new download" button or stale info
           setVideoInfo(null);
           setIsPlaylist(false);
           setSelectedVideoUrls([]);
           setShowPlaylistPicker(false);
           setSelectedFormat('');
           setDownloadProgress(null);
           setIsDownloading(false);
           
           setUrl(payload.url);
           setActiveView('main');
           setCurrentStep(1);
           setIsAnalyzing(true);
           
           try {
             const info = await invoke<VideoInfo>('analyze_url', { url: payload.url });
             setVideoInfo(info);
             setIsAnalyzing(false);
             
             // IMPORTANT: Set selected video URLs so the Download button works
             if (info._type === 'playlist' || (info.entries && info.entries.length > 0)) {
                setIsPlaylist(true);
                const ids = (info.entries?.map(e => e.id || e.webpage_url || e.url) || []).filter((id): id is string => !!id);
                setSelectedVideoUrls(ids);
             } else {
                setIsPlaylist(false);
                const id = info.id || info.webpage_url || info.url || payload.url;
                setSelectedVideoUrls([id]);
             }
             
             // Map resolution from payload to a format ID
             let formatId = 'bestvideo+bestaudio/best';
             const res = payload.resolution || '';
             
             if (res === 'audio_mp3') {
                 formatId = 'mp3';
             } else if (res === 'audio_aac') {
                 formatId = 'aac_audio';
             } else if (res.includes('__')) {
                 const [h, codec] = res.split('__');
                 formatId = `bestvideo[height<=${h}]+bestaudio/best__${codec}`;
             } else if (res === 'audio') {
                 formatId = 'mp3';
             } else {
                 const h = parseInt(res);
                 if (h) formatId = `bestvideo[height<=${h}]+bestaudio/best__aac`;
             }
             
             setSelectedFormat(formatId);
             
             // Jump to Step 3 or 4 depending on whether we have a save path
             const latestSettings = await invoke<Settings>('load_settings');
             const sp = latestSettings.savePath;
             if (sp) {
                setSettings(prev => ({ ...prev, savePath: sp }));
                setCurrentStep(4);
                addLog('Analysis complete. Ready to download.');
             } else {
                setCurrentStep(3);
                addLog('Analysis complete. Please select destination.');
             }
           } catch (err) {
             setIsAnalyzing(false);
             addLog(`Active analysis failed: ${err}`);
           }
           return;
        }
        
        // SILENT MODE
        let formatId = 'bestvideo+bestaudio/best';
        const res = payload.resolution || '';
        
        if (res === 'audio_mp3') {
            formatId = 'mp3';
        } else if (res === 'audio_aac') {
            formatId = 'aac_audio';
        } else if (res.includes('__')) {
            const [h, codec] = res.split('__');
            formatId = `bestvideo[height<=${h}]+bestaudio/best__${codec}`;
        } else if (res === 'audio') {
            formatId = 'mp3';
        } else {
            const h = parseInt(res);
            if (h) formatId = `bestvideo[height<=${h}]+bestaudio/best__aac`;
        }
        
        const latestSettings = await invoke<Settings>('load_settings');
        const savePath = latestSettings.savePath;
        
        if (!savePath) {
           addLog('No custom destination set. Using system Downloads folder.');
        }
 
        // Add to history immediately for real-time tracking
        const silentId = nextDownloadId();
        addHistory(payload.title || 'Silent Download', payload.url, savePath || '', 'downloading', silentId);

        runDownloadRef.current!({
          id: silentId,
          url: payload.url,
          formatId,
          savePath: savePath || '',
          dlSubtitles: latestSettings.dlSubtitles,
          title: payload.title || null,
          section: null
        }).then(() => {
           addLog(`Silent download finished: ${payload.title || payload.url}`);
        }).catch(e => {
           addLog(`Silent download failed: ${e}`);
           // Update status to error in history
           setSettings(prev => ({
             ...prev,
             history: prev.history.map(h => h.url === payload.url ? { ...h, status: 'error' } : h)
           }));
        });
      } catch (e) {
        addLog(`Failed to process download payload: ${e}`);
      }
    });

    const unlistenPlaylist = listen<VideoInfo>('playlist-entry', (event) => {
      const entry = event.payload;
      
      // Ensure thumbnail is set if only thumbnails array exists
      if (!entry.thumbnail && entry.thumbnails && entry.thumbnails.length > 0) {
        entry.thumbnail = entry.thumbnails[entry.thumbnails.length - 1].url;
      }
      
      setVideoInfo(prev => {
        if (!prev) return null;
        // Map entry to its most unique identifier
        const key = entry.id || entry.webpage_url || entry.url || '';
        const entriesMap = new Map((prev.entries || []).map(e => [e.id || e.webpage_url || e.url || '', e]));
        entriesMap.set(key, entry);
        return { ...prev, entries: Array.from(entriesMap.values()) };
      });

      setSelectedVideoUrls(prev => {
        const key = entry.id || entry.webpage_url || entry.url || '';
        if (prev.includes(key)) return prev;
        return [...prev, key];
      });
    });

    return () => {
      unlistenProgress.then(f => f());
      unlistenLog.then(f => f());
      unlistenDownloadUrl.then(f => f());
      unlistenSilentDownload.then(f => f());
      unlistenPlaylist.then(f => f());
    };
  }, []);

  const resetSession = () => {
    setUrl('');
    setIsAnalyzing(false);
    analysisCancelled.current = true;
    downloadCancelled.current = true;
    setVideoInfo(null);
    setIsPlaylist(false);
    setSelectedVideoUrls([]);
    setShowPlaylistPicker(false);
    setSelectedFormat('');
    setCurrentStep(1);
    setDownloadProgress(null);
    setIsDownloading(false);
    addLog('Session reset. Ready for new download.');
  };

  const handleAnalyze = async (targetUrl?: string) => {
    // `targetUrl` lets the extension listener analyze immediately without waiting
    // for the `url` state to round-trip through a render.
    const url = targetUrl ?? urlRef.current;
    if (!url) return;

    setIsAnalyzing(true);
    analysisCancelled.current = false;
    setVideoInfo(null);
    setIsPlaylist(false);
    setSelectedVideoUrls([]);
    setShowPlaylistPicker(false);
    setSelectedFormat('');

    addLog(`Analyzing URL: ${url.substring(0, 40)}${url.length > 40 ? '...' : ''}`);

    try {
      const info = await invoke<VideoInfo>('analyze_url', { url });

      if (analysisCancelled.current) {
        return;
      }

      setVideoInfo(info);
      
      if (info._type === 'playlist' || (info.entries && info.entries.length > 0)) {
        setIsPlaylist(true);
        const initialIds = info.entries?.map(e => e.id || e.webpage_url) || [];
        setSelectedVideoUrls(initialIds);
        setShowPlaylistPicker(true);
        addLog(`Playlist detected: "${info.title}" (${initialIds.length} items)`);
      } else {
        setIsPlaylist(false);
        setShowPlaylistPicker(false);
        const videoId = info.id || info.webpage_url;
        setSelectedVideoUrls([videoId]);

        // Format duration for logging
        let durationStr = '';
        if (info.duration) {
          const mins = Math.floor(info.duration / 60);
          const secs = Math.floor(info.duration % 60);
          durationStr = ` [${mins}:${secs.toString().padStart(2, '0')}]`;
        }

        addLog(`Analysis complete: "${info.title}"${durationStr}`);
        
        if (info.formats && info.formats.length > 0) {
          let selected = null;
          if (settings.defaultResolution === 'audio-only') {
            selected = info.formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none')
              .sort((a, b) => (b.filesize || 0) - (a.filesize || 0))[0];
          } else if (settings.defaultResolution !== 'custom') {
            const targetRes = parseInt(settings.defaultResolution);
            selected = info.formats.find(f => 
              f.vcodec !== 'none' && 
              f.acodec !== 'none' && 
              (f.resolution?.includes(targetRes.toString()) || false)
            );
          }
          
          if (!selected) {
            selected = info.formats.find(f => f.vcodec !== 'none' && f.acodec !== 'none');
          }
          
          if (selected) setSelectedFormat(selected.format_id);
        }

        const nextStepNum = settings.defaultResolution === 'custom' ? 2 : 3;
        if (settings.autoAdvance) {
          const stepLabel = nextStepNum === 2 ? 'format selection' : 'destination selection';
          addLog(`Auto-advancing to ${stepLabel}...`);
          setTimeout(() => setCurrentStep(nextStepNum), 500);
        } else {
          setCurrentStep(nextStepNum);
        }
      }
    } catch (error) {
      if (!analysisCancelled.current) {
        addLog(`Error: ${error}`);
        toast(`Failed to analyze URL: ${error}`, 'error');
      }
    } finally {
      if (!analysisCancelled.current) {
        setIsAnalyzing(false);
      }
    }
  };

  handleAnalyzeRef.current = handleAnalyze;
  urlRef.current = url;
  runDownloadRef.current = runDownload;
  concurrencyRef.current = Math.max(1, settings.concurrentDownloads || 1);

  const handleStopAnalysis = () => {
    analysisCancelled.current = true;
    setIsAnalyzing(false);
    addLog('Analysis cancelled by user.');
  };

  const toggleVideo = (id: string) => {
    setSelectedVideoUrls(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const selectAllVideos = () => {
    if (!videoInfo || !videoInfo.entries) return;
    const allIds = videoInfo.entries.map(e => e.id || e.webpage_url);
    setSelectedVideoUrls(allIds);
  };

  const deselectAllVideos = () => {
    setSelectedVideoUrls([]);
  };

  const handlePlaylistContinue = () => {
    setShowPlaylistPicker(false);
    
    if (settings.defaultResolution === 'audio-mp3') {
      setSelectedFormat('mp3');
    } else if (settings.defaultResolution === 'audio-aac') {
      setSelectedFormat('aac_audio');
    } else if (settings.defaultResolution !== 'custom') {
      // Handle the new format like "1080p__aac" or "1080p__opus"
      const [resStr, codec] = settings.defaultResolution.split('__');
      const res = parseInt(resStr);
      const suffix = codec === 'opus' ? '__opus' : '__aac';
      setSelectedFormat(`bestvideo[height<=${res}]+bestaudio/best${suffix}`);
    } else {
      // Default for Custom in playlists
      setSelectedFormat('bestvideo+bestaudio/best');
    }
    
    const nextStepNum = settings.defaultResolution === 'custom' ? 2 : 3;
    setCurrentStep(nextStepNum);
    addLog(`Proceeding with ${selectedVideoUrls.length} selected videos.`);
  };

  const handleSelectPath = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected) {
        setSettings(prev => ({ ...prev, savePath: selected as string }));
        addLog(`Destination set to: ${selected}`);
      }
    } catch (error) {
      addLog(`Error selecting folder: ${error}`);
    }
  };

  /**
   * The download engine. Takes everything explicitly rather than reading component
   * state, so Quick Grab can drive it in the same tick it finishes analysing —
   * before the corresponding setState calls have landed.
   */
  const runQueue = async (opts: {
    videoIds: string[];
    formatId: string;
    info: VideoInfo | null;
    playlist: boolean;
    fallbackUrl: string;
    destination: string;
    section?: string | null;
  }) => {
    const { videoIds, formatId, info, playlist, fallbackUrl, destination, section } = opts;
    if (videoIds.length === 0 || !destination) return;

    setIsDownloading(true);
    downloadCancelled.current = false;
    addLog(`Starting download of ${videoIds.length} video(s) (Concurrency: ${settings.concurrentDownloads})...`);

    setQueue({ total: videoIds.length, done: 0 });

    const pending = [...videoIds];
    let completed = 0;

    const downloadWorker = async () => {
      while (pending.length > 0) {
        if (downloadCancelled.current) break;

        const videoId = pending.shift();
        if (!videoId) break;

        // Strict mapping: find the specific entry by id or URL. In playlist mode we
        // MUST have an entry with its own URL; single mode falls back to the input.
        const videoEntry = playlist
          ? info?.entries?.find(e => (e.id || e.webpage_url || e.url) === videoId)
          : info;

        const videoUrl = videoEntry?.webpage_url || videoEntry?.url || (!playlist ? fallbackUrl : null);

        if (!videoUrl) {
          addLog(`Error: Could not determine URL for video [${videoId}]. Skipping.`);
          completed++;
          continue;
        }

        const videoName = videoEntry?.title || videoUrl.substring(0, 50);
        const downloadId = nextDownloadId();
        addLog(`Downloading: ${videoName}...`);
        addHistory(videoEntry?.title || 'Unknown Video', videoUrl, destination, 'downloading', downloadId);

        try {
          await runDownload({
            id: downloadId,
            url: videoUrl,
            formatId: formatId || 'bestvideo+bestaudio/best',
            savePath: destination,
            dlSubtitles: settings.dlSubtitles,
            title: videoEntry?.title || null,
            // Trimming only makes sense for a single video, never a playlist run.
            section: !playlist ? section ?? null : null,
          });

          // A cancelled job also resolves; don't report it as finished.
          if (cancelledIds.current.has(downloadId) || downloadCancelled.current) {
            cancelledIds.current.delete(downloadId);
            continue;
          }

          completed++;
          setQueue(q => ({ ...q, done: q.done + 1 }));
          addLog(`Finished: ${videoName}`);

          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Grabix Pro", { body: `Finished downloading: ${videoName}` });
          }

          addHistory(videoEntry?.title || 'Unknown Video', videoUrl, destination, 'finished', downloadId);
        } catch (error) {
          if (!downloadCancelled.current && !cancelledIds.current.has(downloadId)) {
            addLog(`Error downloading ${videoUrl}: ${error}`);
            addHistory(videoEntry?.title || 'Unknown Video', videoUrl, destination, 'error', downloadId);
            completed++;
          }
        }
      }
    };

    const workers = [];
    const workerCount = Math.min(settings.concurrentDownloads, pending.length);
    for (let i = 0; i < workerCount; i++) {
      workers.push(downloadWorker());
    }

    await Promise.all(workers);

    if (!downloadCancelled.current) {
      setIsDownloading(false);
      setDownloadProgress({ status: 'finished', progress: 100 });
      addLog('All downloads completed.');
      toast(
        completed === 1 ? 'Download complete.' : `${completed} downloads complete.`,
        'success',
      );

      if (settings.autoOpenFolder && destination) {
        revealItemInDir(destination).catch((e: unknown) => {
          addLog(`Error opening folder: ${e}`);
        });
      }
    }
  };

  const handleStartDownload = () =>
    runQueue({
      videoIds: selectedVideoUrls,
      formatId: selectedFormat,
      info: videoInfo,
      playlist: isPlaylist,
      fallbackUrl: url,
      destination: savePath,
      section: trimSection(),
    });

  /**
   * Quick Grab: URL straight to finished file. Skips format and destination
   * selection entirely, which are pure friction once the user has a default
   * resolution and a save path. Playlists fall back to the normal picker.
   */
  const quickGrab = async () => {
    if (!url || !canQuickGrab) return;

    setIsAnalyzing(true);
    analysisCancelled.current = false;
    addLog('Quick Grab: analyzing...');

    try {
      const info = await invoke<VideoInfo>('analyze_url', { url });
      if (analysisCancelled.current) return;

      setVideoInfo(info);
      setIsAnalyzing(false);

      if (info._type === 'playlist' || (info.entries && info.entries.length > 0)) {
        // Not a quick job — hand it to the normal playlist flow.
        setIsPlaylist(true);
        setSelectedVideoUrls(info.entries?.map(e => e.id || e.webpage_url) || []);
        setShowPlaylistPicker(true);
        setCurrentStep(1);
        addLog('Playlist detected — falling back to the picker.');
        return;
      }

      const videoId = info.id || info.webpage_url;
      const formatId = resolutionToFormatId(settings.defaultResolution);

      setIsPlaylist(false);
      setSelectedVideoUrls([videoId]);
      setSelectedFormat(formatId);
      setCurrentStep(4);

      await runQueue({
        videoIds: [videoId],
        formatId,
        info,
        playlist: false,
        fallbackUrl: url,
        destination: savePath,
      });
    } catch (error) {
      setIsAnalyzing(false);
      if (!analysisCancelled.current) {
        addLog(`Quick Grab failed: ${error}`);
        toast(`Quick Grab failed: ${error}`, 'error');
      }
    }
  };

  const handleStopDownload = async () => {
    downloadCancelled.current = true;
    setIsDownloading(false);
    addLog('Stopping download and terminating processes...');
    
    try {
      await invoke('stop_all_downloads');
      addLog('All active download processes terminated.');
    } catch (e) {
      addLog(`Error stopping processes: ${e}`);
    }

    setTimeout(resetSession, 500);
  };

  const nextStep = () => {
    if (currentStep === 1 && showPlaylistPicker) {
      handlePlaylistContinue();
    } else if (currentStep < 4) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      if (currentStep === 2 && isPlaylist) {
        setShowPlaylistPicker(true);
        setCurrentStep(1);
      } else {
        setCurrentStep(prev => prev - 1);
      }
    }
  };

  const canGoNext = () => {
    if (currentStep === 1) {
      if (!videoInfo) return false;
      if (showPlaylistPicker) return selectedVideoUrls.length > 0;
      return true;
    }
    if (currentStep === 2) return !!selectedFormat;
    if (currentStep === 3) return !!savePath;
    return false;
  };

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden bg-grabix-bg dark:bg-grabix-bg-dark text-black dark:text-grabix-white font-sans">
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <Header 
            onOpenSettings={() => setIsSettingsOpen(true)} 
            onOpenHistory={() => setActiveView(activeView === 'history' ? 'main' : 'history')} 
          />
          
          <div className="flex-shrink-0 px-7 pt-6 space-y-4 bg-grabix-bg dark:bg-grabix-bg-dark z-20 pb-4 border-b border-grabix-border dark:border-grabix-border-dark shadow-sm">
            <div className="max-w-4xl mx-auto w-full flex gap-3">
              <div className="relative flex-1">
                <input 
                  type="text" 
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste video or playlist URL here..." 
                  className="w-full h-12 px-5 pr-20 rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark text-sm focus:outline-none focus:border-grabix-purple transition-all shadow-sm"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-3 text-grabix-dim">
                  {url && !isAnalyzing && (
                    <button onClick={() => setUrl('')} className="hover:text-grabix-purple transition-colors"><X size={18} /></button>
                  )}
                  <Search size={18} />
                </div>
              </div>
              {/* Quick Grab: one click from URL to file. Only offered when we already
                  know the resolution and where to put it — otherwise it would have to
                  ask, which is exactly the friction it exists to remove. */}
              {canQuickGrab && !isAnalyzing && !isDownloading && (
                <button
                  onClick={quickGrab}
                  disabled={!url}
                  title={`Download straight away at ${settings.defaultResolution.replace('__', ' · ')} to ${savePath}`}
                  className="px-6 h-12 rounded-2xl text-sm font-bold transition-all shadow-lg active:scale-[0.98] bg-green-500 hover:bg-green-600 text-white shadow-green-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Zap size={16} />
                  Quick Grab
                </button>
              )}
              <button
                onClick={() => (isAnalyzing ? handleStopAnalysis() : handleAnalyze())}
                disabled={!url && !isAnalyzing}
                className={`px-8 h-12 rounded-2xl text-sm font-bold transition-all shadow-lg active:scale-[0.98] ${
                  isAnalyzing
                    ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/20'
                    : 'bg-grabix-purple hover:bg-grabix-purple-hover text-white shadow-grabix-purple/20'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isAnalyzing ? 'Stop' : 'Analyze'}
              </button>
              <button 
                onClick={resetSession}
                className="w-12 h-12 flex items-center justify-center rounded-2xl bg-grabix-surface dark:bg-grabix-input-dark border border-grabix-border dark:border-grabix-border-dark text-grabix-muted hover:text-grabix-purple transition-all active:scale-[0.98]"
                title="Reset Session"
              >
                <RotateCcw size={20} />
              </button>
            </div>

            {isAnalyzing && (
              <div className="max-w-4xl mx-auto w-full space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex justify-between items-center px-1">
                  <span className="text-[10px] font-bold text-grabix-purple uppercase tracking-widest">Processing Data...</span>
                </div>
                <div className="h-1.5 w-full bg-grabix-purple/10 rounded-full overflow-hidden">
                  <div className="h-full bg-grabix-purple rounded-full w-1/3 animate-progress-indeterminate" />
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
            {activeView === 'main' ? (
              <>
                <div className="flex-shrink-0">
                  <StepsIndicator steps={STEPS} currentStep={currentStep} />
                </div>
                
                <div className="px-7 pb-10">
                  <div className="max-w-4xl mx-auto w-full">
                    <div className="p-8 rounded-3xl bg-grabix-surface dark:bg-grabix-surface-dark border border-grabix-border dark:border-grabix-border-dark shadow-xl shadow-black/5 dark:shadow-none transition-all">
                      {currentStep === 1 && (
                        showPlaylistPicker && videoInfo ? (
                          <PlaylistStep 
                            info={videoInfo} 
                            selectedVideos={selectedVideoUrls} 
                            toggleVideo={toggleVideo} 
                            onSelectAll={selectAllVideos}
                            onDeselectAll={deselectAllVideos}
                            onContinue={handlePlaylistContinue} 
                            settings={settings}
                          />
                        ) : (
                          <div className="p-4 rounded-xl bg-grabix-purple/5 border border-grabix-purple/10 text-center py-20">
                             <div className="w-20 h-20 bg-grabix-purple/20 rounded-full flex items-center justify-center mx-auto mb-6">
                                <Search className="text-grabix-purple" size={40} />
                             </div>
                             <h3 className="text-xl font-bold mb-3">Ready to Analyze</h3>
                             <p className="text-sm text-grabix-muted max-w-sm mx-auto leading-relaxed">
                                Paste a link from YouTube, Vimeo, or other supported sites above and click Analyze to discover videos.
                             </p>
                          </div>
                        )
                      )}
                      {currentStep === 2 && (
                        <FormatStep
                          info={videoInfo}
                          selectedFormat={selectedFormat}
                          setSelectedFormat={setSelectedFormat}
                          selectedVideos={selectedVideoUrls}
                          settings={settings}
                          trimEnabled={trimEnabled}
                          trimStart={trimStart}
                          trimEnd={trimEnd}
                          onTrimToggle={setTrimEnabled}
                          onTrimChange={(s, e) => { setTrimStart(s); setTrimEnd(e); }}
                        />
                      )}
                      {currentStep === 3 && (
                        <DestinationStep 
                          savePath={savePath} 
                          onSelectPath={handleSelectPath} 
                        />
                      )}
                      {currentStep === 4 && (
                        <DownloadStep
                          progress={downloadProgress}
                          onStart={handleStartDownload}
                          onStop={handleStopDownload}
                          isDownloading={isDownloading}
                          onReset={resetSession}
                          url={url}
                          selectedFormat={selectedFormat}
                          savePath={savePath}
                          queueStats={queueStats}
                          thumbnail={settings.showThumbnail ? videoInfo?.thumbnail : undefined}
                          videoTitle={videoInfo?.title}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="px-7 py-10">
                <div className="max-w-4xl mx-auto w-full">
                  <DownloadedVideos
                    history={historyView}
                    onRemove={removeHistoryEntry}
                    onClear={clearHistory}
                    onCancel={cancelOne}
                    onRetry={retryOne}
                  />
                </div>
              </div>
            )}
          </div>

          {activeView === 'main' && (
            <footer className="flex-shrink-0 px-7 py-5 flex items-center justify-between border-t border-grabix-border dark:border-grabix-border-dark bg-white/50 dark:bg-grabix-bg-dark/50 backdrop-blur-sm">
              <button 
                onClick={prevStep}
                disabled={currentStep === 1 || isDownloading}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-grabix-surface dark:bg-grabix-input-dark text-grabix-muted text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-grabix-border dark:hover:bg-grabix-border-dark transition-all"
              >
                <ChevronLeft size={18} />
                Previous
              </button>
              
              {currentStep === 4 ? (
                <div className="flex-1 max-w-sm ml-auto">
                  {isDownloading ? (
                    <button 
                      onClick={handleStopDownload}
                      className="w-full h-12 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold flex items-center justify-center gap-3 transition-all shadow-lg shadow-red-500/20 active:scale-[0.98]"
                    >
                      <X size={18} />
                      STOP DOWNLOAD
                    </button>
                  ) : downloadProgress?.status === 'finished' ? (
                    <button 
                      onClick={resetSession}
                      className="w-full h-12 rounded-xl bg-grabix-purple hover:bg-grabix-purple-hover text-white font-bold flex items-center justify-center gap-3 transition-all shadow-lg shadow-grabix-purple/20 active:scale-[0.98]"
                    >
                      <RotateCcw size={18} />
                      NEW DOWNLOAD
                    </button>
                  ) : (
                    <button 
                      onClick={handleStartDownload}
                      disabled={!savePath}
                      className="w-full h-12 rounded-xl bg-green-500 hover:bg-green-600 text-white font-bold flex items-center justify-center gap-3 transition-all shadow-lg shadow-green-500/20 active:scale-[0.98] disabled:opacity-50"
                    >
                      <CloudDownload size={18} />
                      START DOWNLOAD
                    </button>
                  )}
                </div>
              ) : (
                <button 
                  onClick={nextStep}
                  disabled={!canGoNext()}
                  className="flex items-center gap-2 px-8 py-3 rounded-xl bg-grabix-purple hover:bg-grabix-purple-hover text-white text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-grabix-purple/20 transition-all active:scale-[0.98]"
                >
                  {currentStep === 1 && isPlaylist ? `Continue with ${selectedVideoUrls.length} items` : 'Next'}
                  <ChevronRight size={18} />
                </button>
              )}
            </footer>
          )}
        </div>

        {showLogs && settings.showActivity && (
          <Sidebar logs={logs} onClear={() => setLogs([])} />
        )}

        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          settings={settings}
          setSettings={setSettings}
          history={historyView}
          savePath={savePath}
          onSelectPath={handleSelectPath}
        />
      </div>
    </ThemeProvider>
  );
}

export default App;
