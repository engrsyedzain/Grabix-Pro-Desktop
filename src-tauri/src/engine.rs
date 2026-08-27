//! Provisions the three binaries the app drives: yt-dlp, ffmpeg and ffprobe.
//!
//! None of them ship with the app. Between them they are ~190 MB of executable,
//! which dominated an installer whose own code is under 20 MB, and yt-dlp in
//! particular is stale within weeks - it breaks whenever a site changes its
//! player, so a copy frozen at build time fails on exactly the sites people
//! installed the app for. Fetching them instead keeps the installer small and
//! the engine current.
//!
//! The two are treated differently on purpose:
//!
//!   * yt-dlp is version-checked against GitHub on every launch and replaced
//!     when a newer release exists.
//!   * ffmpeg and ffprobe are fetched once and then left alone. They are pinned
//!     to a release, do not care what YouTube did this week, and re-checking
//!     them would spend a network round trip per launch on a question whose
//!     answer never changes.
//!
//! Anything missing blocks the UI behind a progress overlay driven by
//! `engine-status`, because there is no useful work the app can do without it.

use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::deps::{get_deps_dir, get_ffmpeg_path, get_ffprobe_path, get_ytdlp_path};

/// Release metadata for the stable channel. yt-dlp tags releases as `YYYY.MM.DD`.
const LATEST_RELEASE_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

/// GitHub rejects API requests that send no User-Agent.
const USER_AGENT: &str = "GrabixPro";

/// Asset name for this platform inside a yt-dlp release.
const YTDLP_ASSET: &str = if cfg!(target_os = "windows") {
    "yt-dlp.exe"
} else if cfg!(target_os = "macos") {
    "yt-dlp_macos"
} else {
    "yt-dlp_linux"
};

/// GyanD's "essentials" Windows build.
///
/// The GPL build specifically: it carries libmp3lame, and without that there is
/// no MP3 encoder at all, so the app's MP3 export would fail. The LGPL builds
/// are smaller and useless to us for that reason.
///
/// The `.7z` rather than the `.zip` of the same release: 28 MB against 92 MB for
/// byte-identical binaries. That is worth a decoder dependency.
const FFMPEG_ARCHIVE_URL: &str =
    "https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.7z";

/// Which binary a status refers to, so the overlay can name what it is doing.
const COMPONENT_ENGINE: &str = "engine";
const COMPONENT_MEDIA: &str = "media";

/// What the frontend renders. `blocking` is the only field the overlay keys off
/// for whether to lock the UI - the phase and component drive wording, not policy.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    /// "engine" (yt-dlp) or "media" (ffmpeg/ffprobe).
    pub component: String,
    /// "idle" | "checking" | "downloading" | "installing" | "ready" | "error"
    pub phase: String,
    pub message: String,
    /// 0-100 while downloading, `None` otherwise (or when the server sends no
    /// Content-Length, in which case the overlay shows an indeterminate bar).
    pub progress: Option<f64>,
    /// yt-dlp version currently on disk, once known.
    pub version: Option<String>,
    /// Newest yt-dlp version on GitHub, once known.
    pub latest: Option<String>,
    /// True while the app must not be used.
    pub blocking: bool,
}

impl Default for EngineStatus {
    fn default() -> Self {
        Self {
            component: COMPONENT_ENGINE.to_string(),
            phase: "idle".to_string(),
            message: String::new(),
            progress: None,
            version: None,
            latest: None,
            blocking: false,
        }
    }
}

impl EngineStatus {
    fn new(component: &str, phase: &str, message: impl Into<String>, blocking: bool) -> Self {
        Self {
            component: component.to_string(),
            phase: phase.to_string(),
            message: message.into(),
            blocking,
            ..Default::default()
        }
    }

    fn progress(mut self, progress: Option<f64>) -> Self {
        self.progress = progress;
        self
    }

    fn version(mut self, version: Option<String>) -> Self {
        self.version = version;
        self
    }

    fn latest(mut self, latest: Option<String>) -> Self {
        self.latest = latest;
        self
    }
}

/// Last status emitted.
///
/// Provisioning starts in `setup`, before the webview's JS exists, so the first
/// events would be emitted to nobody - the same race the launch payload and the
/// notification window each hit. Rather than queueing (replaying a stale
/// "downloading 12%" later is worse than useless), the current status is kept
/// here: the frontend reads it once on mount via `get_engine_status`, then
/// follows the event stream.
#[derive(Default)]
pub struct EngineState(pub Mutex<EngineStatus>);

fn set_status(app: &AppHandle, status: EngineStatus) {
    if let Ok(mut guard) = app.state::<EngineState>().0.lock() {
        *guard = status.clone();
    }
    let _ = app.emit("engine-status", status);
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())
}

/// Runs `<binary> --version`. yt-dlp versions are `YYYY.MM.DD`, so the returned
/// strings order correctly under a plain lexicographic compare.
pub async fn installed_version(path: &Path) -> Option<String> {
    if !path.exists() {
        return None;
    }

    use tokio::process::Command;

    let mut cmd = Command::new(path);
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let out = cmd.output().await.ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
}

/// Newest stable yt-dlp tag on GitHub, or an error string fit to show a user.
async fn latest_version() -> Result<String, String> {
    let release: Release = http_client()?
        .get(LATEST_RELEASE_API)
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub returned an error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Could not read the release info: {e}"))?;

    Ok(release.tag_name.trim().to_string())
}

/// Stream `url` to `dest`, reporting progress against `component` as it goes.
///
/// Writes to a sibling temp file and renames into place, so an interrupted
/// download can never leave a half-written file that something is then run from.
async fn download_to(
    app: &AppHandle,
    url: &str,
    dest: &Path,
    component: &str,
    message: &str,
) -> Result<(), String> {
    let response = http_client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Download failed: {e}"))?;

    let total = response.content_length();
    let tmp = dest.with_extension("download");
    // A leftover temp file from an interrupted run must not be reused.
    let _ = std::fs::remove_file(&tmp);

    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    // Percent last reported. An event per chunk floods the webview for no
    // visible gain, so only whole-percent changes are emitted.
    let mut last_percent = -1.0_f64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("The download was interrupted: {e}"))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        if let Some(total) = total.filter(|t| *t > 0) {
            let percent = (downloaded as f64 / total as f64 * 100.0).clamp(0.0, 100.0);
            if percent.floor() > last_percent {
                last_percent = percent.floor();
                set_status(
                    app,
                    EngineStatus::new(component, "downloading", message, true)
                        .progress(Some(percent)),
                );
            }
        }
    }

    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&tmp)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&tmp, perms).map_err(|e| e.to_string())?;
    }

    std::fs::rename(&tmp, dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not save the download: {e}")
    })
}

/// What a provisioning step produced.
struct Provisioned {
    /// Version on disk, where there is one to report.
    version: Option<String>,
    /// Something went wrong but the component still works - an offline launch,
    /// say. Worth telling the user once, not worth blocking them over.
    warning: Option<String>,
}

/// Fetch yt-dlp if it is missing, and replace it when GitHub has a newer release.
async fn ensure_ytdlp(app: &AppHandle) -> Result<Provisioned, String> {
    let path = get_ytdlp_path(app);
    let installed = installed_version(&path).await;
    let missing = installed.is_none();

    set_status(
        app,
        EngineStatus::new(
            COMPONENT_ENGINE,
            "checking",
            if missing {
                "Getting the download engine ready"
            } else {
                "Checking for engine updates"
            },
            missing,
        )
        .version(installed.clone()),
    );

    let latest = match latest_version().await {
        Ok(v) => v,
        // Offline with a working engine is a normal state, not a failure: let
        // the app run and check again next launch.
        Err(_) if !missing => {
            return Ok(Provisioned {
                version: installed,
                warning: Some("Could not check for engine updates.".to_string()),
            })
        }
        Err(e) => return Err(e),
    };

    // Strictly newer, never equal-or-older: someone who moved to a nightly from
    // Settings must not be silently downgraded to stable on the next launch.
    let needs_update = match &installed {
        Some(current) => latest.as_str() > current.as_str(),
        None => true,
    };

    if !needs_update {
        return Ok(Provisioned {
            version: installed,
            warning: None,
        });
    }

    let verb = if missing { "Downloading" } else { "Updating" };
    let url = format!("https://github.com/yt-dlp/yt-dlp/releases/download/{latest}/{YTDLP_ASSET}");
    let message = format!("{verb} the download engine ({latest})");

    match download_to(app, &url, &path, COMPONENT_ENGINE, &message).await {
        Ok(()) => Ok(Provisioned {
            version: installed_version(&path).await.or(Some(latest)),
            warning: None,
        }),
        // A failed update on a working engine is a warning; a failed first
        // install leaves nothing to run at all.
        Err(e) if !missing => Ok(Provisioned {
            version: installed,
            warning: Some(e),
        }),
        Err(e) => Err(e),
    }
}

/// Fetch ffmpeg and ffprobe if either is missing.
///
/// One archive carries both, so a single download covers either gap. There is no
/// update check: the build is pinned, and unlike yt-dlp it does not go stale.
async fn ensure_media(app: &AppHandle) -> Result<(), String> {
    let ffmpeg = get_ffmpeg_path(app);
    let ffprobe = get_ffprobe_path(app);

    if ffmpeg.exists() && ffprobe.exists() {
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err(
            "ffmpeg and ffprobe are missing. Install them and put them on your PATH.".to_string(),
        );
    }

    #[cfg(target_os = "windows")]
    {
        let archive = get_deps_dir(app).join("ffmpeg-tools.7z");

        download_to(
            app,
            FFMPEG_ARCHIVE_URL,
            &archive,
            COMPONENT_MEDIA,
            "Downloading the media toolkit (FFmpeg)",
        )
        .await?;

        set_status(
            app,
            EngineStatus::new(
                COMPONENT_MEDIA,
                "installing",
                "Unpacking FFmpeg - this takes a moment",
                true,
            ),
        );

        // Decompression is CPU-bound and unpacks ~175 MB; keep it off the async
        // runtime's worker threads.
        let handle = app.clone();
        let result = tokio::task::spawn_blocking(move || extract_media(&handle, &archive))
            .await
            .map_err(|e| format!("Unpacking FFmpeg failed: {e}"))?;

        result?;

        if !ffmpeg.exists() || !ffprobe.exists() {
            return Err("The FFmpeg archive did not contain the expected files.".to_string());
        }

        Ok(())
    }
}

/// Pull ffmpeg.exe and ffprobe.exe out of the downloaded archive, then delete it.
#[cfg(target_os = "windows")]
fn extract_media(app: &AppHandle, archive: &Path) -> Result<(), String> {
    let dir = get_deps_dir(app);
    let wanted = ["bin/ffmpeg.exe", "bin/ffprobe.exe"];
    let mut found = 0usize;

    let outcome = sevenz_rust2::decompress_file_with_extract_fn(archive, &dir, |entry, reader, _| {
        if entry.is_directory() {
            return Ok(true);
        }

        // Entry paths carry the build's own top-level folder, e.g.
        // "ffmpeg-7.1-essentials_build/bin/ffmpeg.exe", which changes with every
        // release - so match on the tail, not the whole path.
        let name = entry.name().replace('\\', "/");
        let want = wanted.iter().find(|w| name.ends_with(*w));

        match want {
            Some(w) => {
                let leaf = w.rsplit('/').next().unwrap_or(w);
                let tmp = dir.join(format!("{leaf}.part"));
                let mut out = std::fs::File::create(&tmp)?;
                std::io::copy(reader, &mut out)?;
                out.flush()?;
                drop(out);
                std::fs::rename(&tmp, dir.join(leaf))?;
                found += 1;
            }
            None => {
                // A 7z solid block is one continuous stream: every entry has to
                // be read through, wanted or not, or the next one decodes
                // against a misaligned window and fails its checksum.
                std::io::copy(reader, &mut std::io::sink())?;
            }
        }

        // Stop once both are out rather than spending another ~90 MB of
        // decompression on ffplay, which this app never runs.
        Ok(found < wanted.len())
    });

    // The archive is ~28 MB of no further use either way.
    let _ = std::fs::remove_file(archive);

    outcome.map_err(|e| format!("Could not unpack FFmpeg: {e}"))?;
    Ok(())
}

/// Make sure everything the app drives is on disk and current. Runs every launch.
pub async fn ensure_engine(app: AppHandle) {
    let engine = ensure_ytdlp(&app).await;

    // Only reached when yt-dlp is usable: two failure overlays for one dead
    // network is noise, and the first message already says what is wrong.
    let media = match &engine {
        Ok(_) => ensure_media(&app).await,
        Err(_) => Ok(()),
    };

    let status = match (engine, media) {
        (Err(e), _) => EngineStatus::new(COMPONENT_ENGINE, "error", e, true),
        (Ok(_), Err(e)) => EngineStatus::new(COMPONENT_MEDIA, "error", e, true),
        (Ok(p), Ok(())) => EngineStatus::new(
            COMPONENT_ENGINE,
            "ready",
            p.warning.clone().unwrap_or_else(|| match &p.version {
                Some(v) => format!("Download engine ready - yt-dlp {v}."),
                None => "Download engine ready.".to_string(),
            }),
            false,
        )
        .version(p.version.clone())
        .latest(p.version),
    };

    set_status(&app, status);
}

/// Status as of right now. Read once by the frontend on mount, because
/// provisioning starts before the webview can listen.
#[tauri::command]
pub fn get_engine_status(app_handle: AppHandle) -> EngineStatus {
    app_handle
        .state::<EngineState>()
        .0
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default()
}

/// Re-run the launch check on demand - the retry button on the overlay, and the
/// "Check for updates" button in Settings.
#[tauri::command]
pub async fn recheck_engine(app_handle: AppHandle) -> Result<(), String> {
    ensure_engine(app_handle).await;
    Ok(())
}
