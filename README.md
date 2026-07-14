# Grabix Pro

A desktop video downloader for Windows, built with Tauri 2, React 19 and Rust. It wraps `yt-dlp` and `ffmpeg` in a guided four-step interface, and ships with a companion browser extension that sends videos from your browser straight to the app.

Repository: <https://github.com/engrsyedzain/Grabix-Pro-Desktop>

---

## Features

### Downloading

- **Four-step flow** — URL → Format → Destination → Download, with an optional auto-advance between steps.
- **Quick Grab** — one click from a pasted URL to a finished file, skipping format and destination selection. Available once a default resolution and a save path are set.
- **Format picker** — every video/audio stream `yt-dlp` reports, plus shortcuts for MP4 + AAC, MP4 + Opus, MP3 and M4A audio-only.
- **Playlists** — playlists are detected automatically; entries stream into a picker as they are discovered so you can select exactly which items to download.
- **Clip trimming** — cut a section out of a single video by start/end time. The cut is keyframe-forced, so it lands where you asked rather than on the nearest keyframe.
- **Concurrent downloads** — a configurable limit that every download path respects, including requests coming from the browser extension.
- **Per-download cancel and retry** — each job tracks its own `yt-dlp` process ID, so cancelling one download leaves the rest of the queue running. Failed or cancelled jobs can be retried from the history list.
- **Subtitles** — optional English subtitle download (`vtt`), with an automatic retry without subtitles if the subtitled attempt fails.
- **Bandwidth limit** — cap the download rate (e.g. `2M`).
- **Browser cookies** — lift cookies from an installed browser to reach age-restricted, private or members-only videos.
- **MP4 output** — downloads are remuxed to MP4 with `+faststart` rather than re-encoded, which is faster and avoids encoding errors.

### App

- **System tray** — closing the window hides the app to the tray so downloads keep running. The tray tooltip and menu show live progress, and the finished entry opens the file's folder.
- **History** — the last 100 downloads, with open-folder, copy-URL, retry, remove and clear-all actions.
- **Activity log** — a live side panel of analysis, progress and error lines.
- **Desktop notifications** on completion.
- **Light and dark themes.**
- **Bundled engine, self-updating** — `yt-dlp`, `ffmpeg` and `ffprobe` ship with the installer and are copied into the app data directory on first run. `yt-dlp` can be updated in place from the About tab, and a newer bundled copy upgrades an older installed one on launch (never downgrading a copy the in-app updater has pushed ahead).
- **Durable settings** — `settings.json` is written atomically and every field carries a default, so a new setting or an interrupted write can't cost you your history. An unreadable file is backed up rather than overwritten.
- **Single instance** — a second launch (for example from the extension) is routed into the running window.

### Browser extension

A Manifest V3 extension for Chrome, Edge, Brave and Firefox that talks to the app over Native Messaging.

- **Floating download button** injected on supported video pages (toggleable).
- **Popup** with connection status, detected page info, a resolution selector, and two actions:
  - **Download** — silent mode: queues the download in the background without bringing the app forward.
  - **Send to Grabix** — active mode: opens the app, analyses the URL and jumps to the download step.
- **Supported sites** — YouTube, Vimeo, Dailymotion, Facebook, Instagram, X/Twitter, Twitch, Bilibili and TikTok. (The app itself accepts any URL `yt-dlp` supports.)
- **Native host registration** — the app registers the messaging host for Chrome, Edge and Firefox on startup; the Settings screen lets you paste an Extension ID to re-register, and documents the manual registry commands as a fallback.

---

## Architecture

```
src/                     React 19 + TypeScript + Tailwind frontend
  App.tsx                Step flow, download queue, concurrency limiter, event listeners
  components/            Step screens, settings modal, history, activity sidebar, trim control
  hooks/                 Theme and toast providers
src-tauri/
  src/lib.rs             Tauri setup, tray icon/menu, launch-argument and payload handling
  src/commands.rs        analyze_url, start_download, cancel/stop, settings, extension setup
  src/deps.rs            Bundles/repairs yt-dlp, ffmpeg and ffprobe in the app data dir
  src/bin/native_host.rs Standalone Native Messaging bridge (grabix-native-host)
  binaries/              yt-dlp, ffmpeg, ffprobe sidecars (Windows x86_64)
extension/               Manifest V3 extension (background, content script, popup)
dist_extension/          Packaged .zip (Chrome/Edge) and .xpi (Firefox)
```

Progress and the final output path are read from `yt-dlp`'s documented `--progress-template` and `--print after_move:filepath` interfaces rather than by scraping its human-readable log, so an engine update can't break progress reporting.

**Message flow from the browser:** extension → `grabix-native-host` (4-byte length-prefixed JSON on stdin) → launches or signals `grabix-pro.exe` with a `--payload` argument → the app emits a `silent-download-request` event that the frontend queues like any other download.

---

## Getting started

### Prerequisites

- Node.js 18+
- Rust (stable) and the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/)
- Windows (the sidecar binaries and native-host registration are Windows-targeted; the Rust code carries macOS/Linux branches but is not built or tested there)

### Development

```powershell
npm install
npm run tauri dev
```

Vite serves the frontend on `http://localhost:1420` and Tauri opens the desktop window against it.

### Build

```powershell
npm run tauri build
```

The installer and binaries land in `src-tauri/target/release/`. `yt-dlp`, `ffmpeg` and `ffprobe` are bundled as external sidecars, and the extension packages are bundled as resources.

### Package the extension

```powershell
./build_extension.ps1
```

Produces `dist_extension/grabix_pro_extension.zip` (Chrome/Edge/Brave) and `dist_extension/grabix_pro_extension.xpi` (Firefox).

### Install the extension

1. Install and launch Grabix Pro at least once — it registers the native messaging host on startup.
2. **Chrome/Edge/Brave:** open `chrome://extensions`, enable Developer mode, and *Load unpacked* from the `extension/` directory (or drag in the `.zip`).
3. Copy the extension's ID, paste it into **Grabix Pro → Settings → Browser Integration**, and click **Register Host**. Chrome requires the ID in the host manifest's allowed origins; Firefox uses a fixed ID and needs no such step.
4. The popup's badge should read **Connected**.

---

## Configuration

Settings, history and the error log live in the app data directory (`%APPDATA%\grabix.pro` on Windows), alongside the `bin/` folder holding the downloader binaries. Everything is configurable from the in-app Settings screen: auto-advance, auto-paste from clipboard, activity log, thumbnails, auto-open folder, concurrency, default resolution, subtitles, playlist mode, cookie source and rate limit.

## Tech stack

React 19 · TypeScript · Tailwind CSS · Vite 7 · Tauri 2 · Rust · Tokio · yt-dlp · FFmpeg

## Notes

Grabix Pro is a front end for `yt-dlp`. Download only content you have the right to download, and respect the terms of service of the sites you use it on.
