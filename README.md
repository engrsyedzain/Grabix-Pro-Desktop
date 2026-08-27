# Grabix Pro

**Download: <https://syed-zain.com>**

A desktop video downloader for Windows, built with Tauri 2, React 19 and Rust. It wraps `yt-dlp` and `ffmpeg` in a guided four-step interface, and ships with a companion browser extension that sends videos from your browser straight to the app.

Website: <https://syed-zain.com> · Repository: <https://github.com/engrsyedzain/Grabix-Pro-Desktop>

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
- **Desktop notifications** — a colour-coded card slides into the bottom-right corner when a download starts and again when it finishes or fails, whether or not the main window is open. Clicking the completion card reveals the file in Explorer. They are drawn in a dedicated always-on-top window rather than as native Windows toasts, which the OS styles and will not let an app colour; the trade-off is that they do not appear in the Action Center.
- **Light and dark themes.**
- **Always-current engine** — `yt-dlp` is never shipped frozen. The installer downloads the newest release from GitHub, and every launch checks for a newer one; when there is one, the app locks the interface behind a progress overlay while it downloads, then carries on. `ffmpeg` and `ffprobe` still ship as sidecars and are copied into the app data directory on first run.
- **Durable settings** — `settings.json` is written atomically and every field carries a default, so a new setting or an interrupted write can't cost you your history. An unreadable file is backed up rather than overwritten.
- **Single instance** — a second launch (for example from the extension) is routed into the running window.

### Browser extension

A Manifest V3 extension for Chrome, Edge, Brave and Firefox that talks to the app over Native Messaging.

- **Floating download button** injected on supported video pages (toggleable).
- **Popup** with connection status, detected page info, a resolution selector, and two actions:
  - **Download** — silent mode: queues the download in the background without bringing the app forward.
  - **Send to Grabix** — active mode: opens the app, analyses the URL and jumps to the download step.
- **Supported sites** — YouTube, Vimeo, Dailymotion, Facebook, Instagram, X/Twitter, Twitch, Bilibili and TikTok. (The app itself accepts any URL `yt-dlp` supports.)
- **Signed for Firefox** — a Mozilla-signed `.xpi` ships with the installer, so Firefox installs it permanently from `about:addons`.
- **Native host registration** — the app registers the Firefox host on startup, using the add-on's fixed ID. Chrome and Edge are registered once you paste the extension's ID into the Settings screen: their host manifest has to name the exact ID, and Chrome generates it when the extension loads.

---

## Architecture

```
src/                     React 19 + TypeScript + Tailwind frontend
  App.tsx                Step flow, download queue, concurrency limiter, event listeners
  notification.tsx       Entry point for the notification overlay window
  components/            Step screens, settings modal, history, activity sidebar, trim control
  hooks/                 Theme and toast providers
src-tauri/
  src/lib.rs             Tauri setup, tray icon/menu, launch-argument and payload handling
  src/commands.rs        analyze_url, start_download, cancel/stop, settings, extension setup
  src/notify.rs          Bottom-right notification overlay window (position, sizing, queue)
  src/deps.rs            Copies the ffmpeg/ffprobe sidecars into the app data dir
  src/engine.rs          Downloads yt-dlp and keeps it current on every launch
  src/bin/native_host.rs Standalone Native Messaging bridge (grabix-native-host)
  binaries/              ffmpeg, ffprobe sidecars (Windows x86_64)
extension/               Manifest V3 extension (background, content script, popup)
installer/               Inno Setup script + build script; setup.exe and the
                         packaged .zip/.xpi land here too (artifacts gitignored)
```

Progress and the final output path are read from `yt-dlp`'s documented `--progress-template` and `--print after_move:filepath` interfaces rather than by scraping its human-readable log, so an engine update can't break progress reporting.

**Message flow from the browser:** extension → `grabix-native-host` (4-byte length-prefixed JSON on stdin) → launches or signals `grabix-pro.exe` with a `--payload` argument → the app emits a `silent-download-request` event that the frontend queues like any other download.

---

## Download

Grab the installer from **<https://syed-zain.com>**. It bundles `ffmpeg` and `ffprobe`, plus the browser extension — including the signed Firefox add-on. `yt-dlp` is fetched from GitHub during setup so you start on the current release rather than whatever was current when the installer was built; if that download fails, the app retrieves it on first launch.

If you want to build it yourself instead, see [Getting started](#getting-started) below.

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

### Build the app

```powershell
npm run tauri build
```

Binaries land in `src-tauri/target/release/`, alongside Tauri's own NSIS and MSI bundles. `ffmpeg` and `ffprobe` are bundled as external sidecars and `extension/` as a resource; `yt-dlp` is downloaded at install time instead.

Use `npm run tauri build` rather than `cargo build --release` — the latter produces a binary that loads the frontend from the dev server instead of embedding it, so the app opens a blank window.

### Build the installer

```powershell
./installer/build-installer.ps1            # full build, then package
./installer/build-installer.ps1 -SkipBuild # package what is already in target/release
```

Produces `installer/GrabixPro_<version>_x64_setup.exe` with [Inno Setup](https://jrsoftware.org/isinfo.php) 6+. The version is read from the exe's metadata, which Tauri stamps from `tauri.conf.json`, so it cannot drift.

The install is **per-user** (`%LOCALAPPDATA%\Programs\Grabix Pro`), and deliberately so: the app rewrites `grabix_pro_host.json` into its own directory on every launch, which a machine-wide install would deny to a standard user and break extension registration.

### Package the extension

```powershell
./build_extension.ps1
```

Produces `installer/grabix_pro_extension.zip` (Chrome/Edge/Brave) and `installer/grabix_pro_extension.xpi` (Firefox). Both hold the same files — the manifest declares `background.scripts` for Firefox alongside `background.service_worker` for Chrome.

### Sign the Firefox add-on

```powershell
$env:AMO_JWT_ISSUER = "user:12345678:123"
$env:AMO_JWT_SECRET = "<secret>"
./sign_extension.ps1                  # unlisted: signed for self-distribution
./sign_extension.ps1 -Channel listed  # submit to AMO for a public listing
```

Firefox refuses to install an unsigned add-on permanently, and it removed installer-based ("sideloaded") add-ons in version 74 — so a Mozilla-signed `.xpi` is the only way to ship one. Signing removes the unsigned block; the user still installs it by hand, once.

The signed `.xpi` returned by AMO is committed under `installer/` and shipped by the installer (see the `SignedXpi` define in `installer/grabix-pro.iss`). Bump `version` in `extension/manifest.json` before re-signing: AMO permanently reserves every version it has seen, even from a failed upload.

### Install the extension

Install and launch Grabix Pro at least once first — it registers the native messaging host on startup.

**Firefox** — open `about:addons`, click the gear icon, choose *Install Add-on From File*, and select `grabix-pro-firefox.xpi` from the `extension` folder in the install directory. It is signed, so it installs permanently. No ID registration: the app authorises the add-on's fixed ID.

**Chrome/Edge/Brave** — open `chrome://extensions`, enable Developer mode, and *Load unpacked* from the `extension` folder in the install directory. Then copy the extension's ID, paste it into **Grabix Pro → Settings → Browser Extension**, and click **Register Host**. This step is not optional: Chrome only permits a native-host connection if the host manifest names that exact ID, and the ID is generated when the extension loads.

The popup's badge should then read **Connected**.

---

## Configuration

Settings, history and the error log live in the app data directory (`%APPDATA%\grabix.pro` on Windows), alongside the `bin/` folder holding the downloader binaries. Everything is configurable from the in-app Settings screen: auto-advance, auto-paste from clipboard, activity log, thumbnails, auto-open folder, concurrency, default resolution, subtitles, playlist mode, cookie source and rate limit.

## Tech stack

React 19 · TypeScript · Tailwind CSS · Vite 7 · Tauri 2 · Rust · Tokio · yt-dlp · FFmpeg

## Notes

Grabix Pro is a front end for `yt-dlp`. Download only content you have the right to download, and respect the terms of service of the sites you use it on.
