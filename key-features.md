# Grabix Pro — Key Features & Technical Highlights

> A cross-platform media downloader shipped as a **Windows desktop app**, an **Android app**, a **browser extension**, and a **marketing website** — four distinct clients over one shared product idea.
>
> Live: [grabix-pro.vercel.app](https://grabix-pro.vercel.app)

---

## 1. At a Glance

| | Details |
|---|---|
| **Products** | Windows desktop app · Android app (arm64-v8a + armeabi-v7a) · Chrome/Edge/Brave/Firefox extension · Landing site |
| **Desktop stack** | Tauri 2 · Rust · Tokio · React 19 · TypeScript · Tailwind CSS · Vite 7 |
| **Mobile stack** | React Native 0.86 · TypeScript · Kotlin · AndroidX WorkManager · MediaStore · ExoPlayer |
| **Extension stack** | Manifest V3 · Native Messaging · vanilla JS (zero dependencies) |
| **Engine layer** | yt-dlp + FFmpeg/FFprobe, driven as subprocesses via machine-readable interfaces |
| **Distribution** | Inno Setup per-user installer · NSIS/MSI bundles · Mozilla-signed `.xpi` · per-ABI APK splits |
| **Codebase** | ~6.5k LOC desktop (TS + Rust) · ~4.8k LOC mobile (TS + Kotlin) · Vite/React landing site |
| **Architecture** | 100% offline — no backend, no accounts, no analytics, no telemetry |

---

## 2. Windows Desktop App (Tauri 2 + Rust + React 19)

### Download workflow

- **Guided four-step flow** — URL → Format → Destination → Download, with optional auto-advance between steps.
- **Quick Grab** — one click from a pasted URL to a finished file, skipping format and destination selection entirely. Unlocked once a default resolution and save path exist.
- **Full format picker** — every video/audio stream yt-dlp reports, curated into readable options: MP4 + AAC (Windows-compatible), MP4 + Opus (fast), MP3 320 kbps, M4A/AAC audio-only, plus quality tags (4K / 2K / Full HD / HD / SD).
- **Playlist support** — playlists are auto-detected; entries **stream into the picker as they are discovered** (an async flat-playlist crawl emitting `playlist-entry` events), so the user can start selecting without waiting for the full crawl.
- **Clip trimming** — cut a section by start/end time using `--download-sections` with `--force-keyframes-at-cuts`, so the cut lands exactly where requested rather than on the nearest keyframe.
- **Concurrent download queue** — a configurable worker-pool limiter (1–5) honoured by *every* entry path, including requests arriving from the browser extension.
- **Per-download cancel and retry** — each job registers its own yt-dlp PID in a `DownloadRegistry`, so cancelling one download leaves the rest of the queue untouched. Process trees are killed with `/T` so spawned FFmpeg children die with the parent.
- **Subtitles** — optional English `vtt` track, with an **automatic retry without subtitles** if the subtitled attempt fails (common on videos with no caption track).
- **Bandwidth limiting** — cap the download rate (e.g. `2M`) via `--limit-rate`.
- **Browser-cookie authentication** — lift cookies from an installed browser (`--cookies-from-browser`) to reach age-restricted, private and members-only videos. Applied at both analysis and download time.
- **MP4 standardisation** — remux to MP4 with `+faststart` rather than re-encode: faster, and avoids encoder errors.
- **Fragment parallelism** — `--concurrent-fragments 4` turns latency-bound DASH downloads (thousands of small fragments) into bandwidth-bound ones.

### Application shell

- **System tray integration** — closing the window hides to tray so downloads keep running. The tray tooltip and menu show live progress, throttled to whole 10% steps to avoid constant redraws; the finished entry opens the file's folder in Explorer.
- **Custom desktop notifications** — colour-coded start/finish/error cards slide into the bottom-right corner, drawn in a dedicated always-on-top transparent webview window rather than as native Windows toasts (the OS styles those and forbids branding). Positioned against the monitor **work area** so they sit above the taskbar, never steal focus, and self-size by reporting their rendered height back to Rust.
- **History** — the last 100 downloads with open-folder, copy-URL, retry, remove and clear-all actions.
- **Live activity log** — a side panel streaming analysis, progress and error lines.
- **Light and dark themes.**
- **Single-instance routing** — a second launch (e.g. from the extension) is funnelled into the already-running window.
- **In-app engine updater** — yt-dlp self-updates in place via `yt-dlp -U` from the user-writable app-data directory, so extractor fixes arrive without reinstalling the app.
- **Self-repairing bundled engine** — yt-dlp, FFmpeg and FFprobe ship with the installer and are copied into app data on first run. A newer bundled copy upgrades an older installed one on launch, while never downgrading a copy the in-app updater has already pushed ahead.

---

## 3. Android App (React Native + Kotlin)

- **Share-sheet grabbing** — an `ACTION_SEND` intent-filter puts Grabix in the system Share sheet. Share a video from YouTube, Facebook or any app and the URL is regex-extracted from the shared text and handed straight to the UI — working on both cold launch and while already running (`singleTask` + `onNewIntent`).
- **Clipboard auto-grab** — the app detects a video link on the clipboard and offers it the moment it is opened or resumed.
- **Quality picker with size estimates** — MP4 from 4K down to SD with file sizes shown up front, or audio-only as MP3 (320 kbps) or M4A (AAC). Raw yt-dlp formats are collapsed into one clean option per available resolution.
- **Default quality, or ask every time** — set 720p once for one-tap grabs, or choose per video.
- **Clip trimming** — a custom dual-thumb range slider sets start/end points; only the requested section is downloaded.
- **Playlist picker** — fetches a playlist flat (fast, no per-video extraction) so the user can choose exactly which entries to queue.
- **Concurrent download queue** — a React context-based manager caps parallel jobs and pumps the queue as slots free, so a large playlist cannot spawn dozens of simultaneous yt-dlp/FFmpeg processes.
- **Durable background downloads** — each job runs in a `CoroutineWorker` under **WorkManager** as a foreground service with a live progress notification. Downloads survive the app being backgrounded or killed; the file still lands in the gallery even if the JS runtime is gone.
- **Gallery integration via MediaStore** — finished files are published to `Movies/GrabixPro` or `Music/GrabixPro` with correct MIME types and **no storage permission on Android 10+**, with a legacy `WRITE_EXTERNAL_STORAGE` + media-scan path for Android ≤ 9.
- **Built-in video player** — an ExoPlayer-backed modal to play anything grabbed without leaving the app.
- **Library** — search, sort (newest / name / size), retry failed downloads, cancel running ones, share via the system sheet, open in an external player, or delete.
- **Subtitles** — optional, de-duplicated to a single English track (`--sub-langs en`, not `en.*`) and embedded into the file, with the same automatic no-subtitle retry as desktop.
- **In-app engine updater** — pull the latest yt-dlp on the STABLE, NIGHTLY or MASTER channel, with a startup safety-net that retries until one update has succeeded.
- **First-run setup flow** — guided onboarding gated on a persisted flag, plus a runtime `POST_NOTIFICATIONS` permission request.
- **Haptic feedback** on grab actions, and a custom dark theme built around the app's crystalline electric-blue/cyan icon palette.

---

## 4. Browser Extension (Manifest V3 + Native Messaging)

- **Cross-browser from one codebase** — Chrome, Edge, Brave and Firefox, with the manifest declaring `background.service_worker` and `background.scripts` side by side.
- **Floating download button (FAB)** injected on supported video pages, toggleable by the user.
- **Popup control panel** — live connection status, detected page info, a resolution selector, and two distinct actions:
  - **Download** (*silent mode*) — queues the download in the background without bringing the app forward.
  - **Send to Grabix** (*active mode*) — opens the app, analyses the URL and jumps straight to the download step.
- **Supported sites** — YouTube, Vimeo, Dailymotion, Facebook (videos / watch / reels), Instagram (posts / reels), X/Twitter, Twitch, Bilibili and TikTok. The desktop app itself accepts any URL yt-dlp supports.
- **Mozilla-signed `.xpi`** ships with the installer so Firefox installs the add-on permanently from `about:addons` — the only viable route since Firefox 74 removed sideloaded add-ons.
- **Automatic native-host registration** — the app writes the Firefox host manifest and `HKCU` registry keys on every startup using the add-on's fixed gecko ID. Chrome and Edge are registered from the Settings screen once the user pastes the extension ID, because Chrome only permits a native-host connection if the manifest names that exact ID, and the ID is generated when the extension loads.

---

## 5. Engineering Highlights

*The problems worth talking about in an interview.*

### Robust subprocess orchestration

Progress and the final output path are read from yt-dlp's **documented machine-readable interfaces** — `--progress-template` with a sentinel-prefixed tab-delimited payload, and `--print after_move:filepath` — rather than by scraping human-readable logs. The original implementation parsed six different English log phrases and split on whitespace hunting for a `%`; any engine update could silently break progress reporting. A legacy fallback parser is retained only for the "already downloaded" case, where `after_move` never fires.

### Race conditions in cold-start event delivery

Tauri's `setup` hook runs *before* the webview has loaded any JS, so emitting an event there reaches zero listeners — extension-triggered downloads into a closed app vanished silently. Solved with a **park-and-flush pattern**: the launch payload is stored in managed state and emitted only when the frontend calls `flush_pending_launch` after attaching its listeners, and it is *taken* rather than cloned so it delivers exactly once and cannot replay. The same class of bug in the notification window is solved by a ready-flag plus queue, since the very first notification of every session would otherwise be lost.

### Data durability

`settings.json` is written **atomically** (temp file + rename) — a bare `fs::write` truncates the live file first, so a crash mid-write left a half-written file that failed to parse and cost the user their entire history. Every field carries a serde `default`, so adding a new setting cannot make old config files fail to deserialize. An unreadable file is **backed up to `.json.corrupt`, never overwritten**, keeping history recoverable. Transient per-download progress is deliberately kept *out* of the persisted blob so `settings.json` is not rewritten on every progress tick.

### Precise process lifecycle management

Cancellation was originally `taskkill /IM yt-dlp.exe` — a name-based kill that took down every yt-dlp on the machine, including the *other* concurrent Grabix downloads and any unrelated yt-dlp the user was running. It was replaced with a **PID registry keyed by download ID**, so cancel targets exactly one job and "stop all" stays scoped to the app's own children. A cancelled job surfaces as a non-zero exit, so the code distinguishes cancellation from genuine failure by checking whether the PID is still registered — otherwise a cancel would be misreported as an error or retried as a subtitle failure.

### Native Messaging bridge (Rust)

A standalone `grabix-native-host` binary implements the Native Messaging protocol — a 4-byte little-endian length prefix followed by UTF-8 JSON on stdin/stdout — with a 4 MB sanity cap. It deliberately omits `#![windows_subsystem = "windows"]`, because the protocol requires functional stdio handles. The full chain: **extension → native host → launches or signals `grabix-pro.exe` with a `--payload` argument → single-instance plugin routes it → app emits `silent-download-request` → frontend queues it like any other download**, honouring the same concurrency limit.

### Platform-native Android integration

Downloads run as `CoroutineWorker` jobs under WorkManager with `FOREGROUND_SERVICE_TYPE_DATA_SYNC` declared for Android 14+ compliance, enqueued with `ExistingWorkPolicy.KEEP` under a unique job ID so an accidental double-enqueue is ignored. Cancellation both cancels the worker *and* destroys the underlying yt-dlp process, so a blocking download actually stops instead of finishing invisibly. Scoped-storage publishing goes through MediaStore with `IS_PENDING` staging.

### Distribution and release engineering

- **Per-user Inno Setup installer** (`%LOCALAPPDATA%\Programs\Grabix Pro`) — deliberately per-user, because the app rewrites its native-host manifest into its own directory on every launch, which a machine-wide install would deny to a standard user and break extension registration.
- Installer version is **read from the exe's own metadata**, which Tauri stamps from `tauri.conf.json`, so it cannot drift.
- **Per-ABI APK splits** (`arm64-v8a`, `armeabi-v7a`) with distinct `versionCode` offsets so devices update correctly — a universal APK would roughly double the download size given the bundled Python and FFmpeg binaries.
- **AMO signing pipeline** for the Firefox add-on, supporting both unlisted (self-distribution) and listed channels.

### Platform-specific hardening

`PYTHONUTF8=1` to defeat cp1252 `[Errno 22]` encoding errors on Windows · `--windows-filenames` + `--restrict-filenames` and an 80-character title template to survive path-length and illegal-character limits · `creation_flags(0x08000000)` on every spawn so no console window ever flashes · Referer and browser User-Agent headers to get past Facebook/Instagram blocks · Android 11+ `<queries>` declarations so contact intents can resolve.

### Privacy as an architectural constraint

No backend, no accounts, no analytics, no telemetry, no ads. The only network traffic is to the video platform being downloaded from, and to GitHub when the user explicitly triggers an engine update. Browser cookies, when enabled, are handed to yt-dlp on the user's own machine and never transmitted anywhere.

---

## 6. Landing Site

A Vite + React + Tailwind marketing site (`grabix-pro.vercel.app`) with hero, platform logos, feature grid, how-it-works walkthrough, download table, open-source credits, and step-by-step per-browser extension install guides driven from a single typed data module.

---

## 7. Portfolio Talking Points

- Shipped **one product across four clients** (Windows, Android, browser extension, web) with a consistent feature set and a shared engine-invocation strategy ported between Rust and Kotlin.
- **Polyglot delivery**: Rust, Kotlin, TypeScript and JavaScript in a single product, plus PowerShell build automation and an Inno Setup packaging pipeline.
- Deep **native-platform integration** on both operating systems: Windows tray, registry, Explorer, custom notification windows and Native Messaging; Android intents, WorkManager, foreground services, MediaStore and scoped storage.
- **Systems-level rigour**: atomic writes, backward- and forward-compatible serialization, PID-scoped process control, event-delivery race elimination, and machine-readable interfaces chosen over fragile log scraping.
- Bug fixes are documented **in the code, alongside the failure they prevent** — the codebase reads as a record of problems diagnosed and reasoned about, not just features added.
- **Privacy-first, offline-by-design architecture** — a deliberate product constraint, not an afterthought.

---

## 8. Attribution

Grabix Pro is a front end around the independent open-source projects **yt-dlp** (Unlicense), **FFmpeg** (LGPL/GPL), **youtubedl-android** (GPL-3.0), React Native, Tauri, AndroidX WorkManager, react-native-video, react-native-svg, Lucide, Vite and Tailwind CSS. The Android app is distributed under GPL-3.0 in accordance with its youtubedl-android dependency. Not affiliated with or endorsed by any platform named.
