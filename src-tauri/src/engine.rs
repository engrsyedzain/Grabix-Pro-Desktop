//! yt-dlp provisioning and update checks.
//!
//! yt-dlp is deliberately NOT bundled with the app any more. The engine breaks
//! whenever a site changes its player, so a copy frozen at build time is stale
//! before the installer is even signed - and the app then fails on exactly the
//! sites people use it for. Instead the installer fetches the current release,
//! and every launch checks GitHub for a newer one.
//!
//! Two situations, two behaviours:
//!   * engine missing (fresh install where the installer's download failed, or a
//!     user who deleted it) - blocking. There is nothing the app can do without it.
//!   * engine present but outdated - also blocking, but briefly: it is a single
//!     ~18 MB file, and starting a download against a stale engine is the exact
//!     failure this module exists to prevent.
//!
//! Either way the frontend paints a status overlay driven by `engine-status`.

use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::deps::get_ytdlp_path;

/// Release metadata for the stable channel. yt-dlp tags releases as `YYYY.MM.DD`.
const LATEST_RELEASE_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

/// GitHub rejects API requests that do not send one.
const USER_AGENT: &str = "GrabixPro";

/// Asset name for this platform inside a yt-dlp release.
const ASSET: &str = if cfg!(target_os = "windows") {
    "yt-dlp.exe"
} else if cfg!(target_os = "macos") {
    "yt-dlp_macos"
} else {
    "yt-dlp_linux"
};

/// What the frontend renders. `blocking` is the only field the overlay keys off
/// for whether to lock the UI - the phase drives wording, not policy.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    /// "idle" | "checking" | "downloading" | "installing" | "ready" | "error"
    pub phase: String,
    pub message: String,
    /// 0-100 while downloading, `None` otherwise (or when the server sends no
    /// Content-Length, in which case the overlay shows an indeterminate bar).
    pub progress: Option<f64>,
    /// Version currently on disk, once known.
    pub version: Option<String>,
    /// Newest version on GitHub, once known.
    pub latest: Option<String>,
    /// True while the app must not be used.
    pub blocking: bool,
}

impl Default for EngineStatus {
    fn default() -> Self {
        Self {
            phase: "idle".to_string(),
            message: String::new(),
            progress: None,
            version: None,
            latest: None,
            blocking: false,
        }
    }
}

/// Last status emitted.
///
/// The provisioning task starts in `setup`, before the webview's JS exists, so
/// the first events would be emitted to nobody - the same race the launch payload
/// and the notification window each hit. Rather than queueing (replaying a stale
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

/// Newest stable tag on GitHub, or an error string fit to show a user.
async fn latest_version() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;

    let release: Release = client
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

/// Fetch `tag` and put it at `dest`, reporting progress as it goes.
///
/// Downloads to a sibling temp file and renames into place, so an interrupted
/// download can never leave a half-written binary that yt-dlp is then run from.
async fn download_version(
    app: &AppHandle,
    tag: &str,
    dest: &Path,
    blocking: bool,
    verb: &str,
) -> Result<(), String> {
    let url = format!("https://github.com/yt-dlp/yt-dlp/releases/download/{tag}/{ASSET}");

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Could not download the engine: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Could not download the engine: {e}"))?;

    let total = response.content_length();
    let tmp = dest.with_extension("download");
    // A leftover temp file from an interrupted run must not be reused.
    let _ = std::fs::remove_file(&tmp);

    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    // Percent last reported. An event per chunk floods the webview for no visible
    // gain, so only whole-percent changes are emitted.
    let mut last_percent = -1.0_f64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("The engine download was interrupted: {e}"))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        if let Some(total) = total.filter(|t| *t > 0) {
            let percent = (downloaded as f64 / total as f64 * 100.0).clamp(0.0, 100.0);
            if percent.floor() > last_percent {
                last_percent = percent.floor();
                set_status(
                    app,
                    EngineStatus {
                        phase: "downloading".to_string(),
                        message: format!("{verb} the download engine ({tag})"),
                        progress: Some(percent),
                        version: None,
                        latest: Some(tag.to_string()),
                        blocking,
                    },
                );
            }
        }
    }

    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    set_status(
        app,
        EngineStatus {
            phase: "installing".to_string(),
            message: "Installing the download engine".to_string(),
            progress: None,
            version: None,
            latest: Some(tag.to_string()),
            blocking,
        },
    );

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
        format!("Could not replace the engine: {e}")
    })?;

    Ok(())
}

/// Make sure a usable, current yt-dlp is on disk. Called on every launch.
pub async fn ensure_engine(app: AppHandle) {
    let path = get_ytdlp_path(&app);
    let installed = installed_version(&path).await;
    // A missing engine is fatal to every feature, so the overlay blocks from the
    // very first event. An outdated one blocks too, but only once we know there
    // really is an update - see below.
    let missing = installed.is_none();

    set_status(
        &app,
        EngineStatus {
            phase: "checking".to_string(),
            message: if missing {
                "Getting the download engine ready".to_string()
            } else {
                "Checking for engine updates".to_string()
            },
            progress: None,
            version: installed.clone(),
            latest: None,
            blocking: missing,
        },
    );

    let latest = match latest_version().await {
        Ok(v) => v,
        Err(e) => {
            // Offline with a working engine is a normal state, not a failure:
            // let the app run and check again next launch.
            if let Some(version) = installed {
                set_status(
                    &app,
                    EngineStatus {
                        phase: "ready".to_string(),
                        message: "Could not check for engine updates.".to_string(),
                        progress: None,
                        version: Some(version),
                        latest: None,
                        blocking: false,
                    },
                );
            } else {
                set_status(
                    &app,
                    EngineStatus {
                        phase: "error".to_string(),
                        message: e,
                        progress: None,
                        version: None,
                        latest: None,
                        blocking: true,
                    },
                );
            }
            return;
        }
    };

    // Strictly newer, never equal-or-older: someone who moved to a nightly from
    // Settings must not be silently downgraded to stable on the next launch.
    let needs_update = match &installed {
        Some(current) => latest.as_str() > current.as_str(),
        None => true,
    };

    if !needs_update {
        set_status(
            &app,
            EngineStatus {
                phase: "ready".to_string(),
                message: "Download engine is up to date.".to_string(),
                progress: None,
                version: installed,
                latest: Some(latest),
                blocking: false,
            },
        );
        return;
    }

    let verb = if missing { "Downloading" } else { "Updating" };
    match download_version(&app, &latest, &path, true, verb).await {
        Ok(()) => {
            let version = installed_version(&path).await.or_else(|| Some(latest.clone()));
            set_status(
                &app,
                EngineStatus {
                    phase: "ready".to_string(),
                    message: format!("Download engine updated to {latest}."),
                    progress: Some(100.0),
                    version,
                    latest: Some(latest),
                    blocking: false,
                },
            );
        }
        Err(e) => {
            // A failed update on a working engine is a warning; a failed first
            // install leaves nothing to run, so only that one keeps the UI locked.
            set_status(
                &app,
                EngineStatus {
                    phase: if missing { "error" } else { "ready" }.to_string(),
                    message: e,
                    progress: None,
                    version: installed,
                    latest: Some(latest),
                    blocking: missing,
                },
            );
        }
    }
}

/// Status as of right now. Read once by the frontend on mount, because the
/// provisioning task starts before the webview can listen.
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
