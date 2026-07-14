use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use serde::{Deserialize, Serialize};
use crate::deps::{get_ytdlp_path, get_ffmpeg_path};
use std::fs::OpenOptions;
use chrono::Local;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::path::Path;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Debug, Serialize, Deserialize)]
struct LogEntry {
    timestamp: String,
    message: String,
}

#[tauri::command]
pub async fn open_file_location(path: String) -> Result<(), String> {
    // Normalize path separators for the current OS
    let clean_path = path.trim_matches('"').replace('/', std::path::MAIN_SEPARATOR.to_string().as_str());
    let path_obj = Path::new(&clean_path);
    
    #[cfg(target_os = "windows")]
    {
        // On Windows, explorer.exe /select,"path" is the most robust way to highlight a file.
        // If the file doesn't exist, we fall back to opening its parent directory.
        if path_obj.exists() {
            if path_obj.is_dir() {
                let _ = std::process::Command::new("explorer")
                    .arg(&clean_path)
                    .spawn();
            } else {
                // Using .arg("/select,") followed by .arg(path) is the safest way to avoid
                // double-quoting issues in Rust's Command implementation on Windows.
                let _ = std::process::Command::new("explorer")
                    .arg("/select,")
                    .arg(&clean_path)
                    .spawn();
            }
        } else if let Some(parent) = path_obj.parent() {
            if parent.exists() {
                let _ = std::process::Command::new("explorer")
                    .arg(parent)
                    .spawn();
            } else {
                // If even the parent doesn't exist, open the default explorer view
                let _ = std::process::Command::new("explorer").spawn();
            }
        } else {
            let _ = std::process::Command::new("explorer").spawn();
        }
    }
    #[cfg(target_os = "macos")]
    {
        if path_obj.exists() {
            let _ = std::process::Command::new("open")
                .arg("-R")
                .arg(&clean_path)
                .spawn();
        } else if let Some(parent) = path_obj.parent() {
            let _ = std::process::Command::new("open").arg(parent).spawn();
        }
    }
    #[cfg(target_os = "linux")]
    {
        if path_obj.exists() {
            let folder = if path_obj.is_dir() { path_obj } else { path_obj.parent().unwrap_or(Path::new("/")) };
            let _ = std::process::Command::new("xdg-open").arg(folder).spawn();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn setup_browser_extension(_app_handle: AppHandle, extension_id: Option<String>) -> Result<String, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path.parent().ok_or("Could not find EXE directory")?;

    #[cfg(target_os = "windows")]
    let native_host_path = exe_dir.join("grabix-native-host.exe");
    #[cfg(not(target_os = "windows"))]
    let native_host_path = exe_dir.join("grabix-native-host");

    let clean_id = extension_id.as_deref().map(|s| s.trim()).unwrap_or("");
    let native_host_str = native_host_path.to_str().ok_or("Invalid native host path")?;
    let mut chrome_registered = false;

    let chrome_manifest_path = exe_dir.join("grabix_pro_host.json");
    if !clean_id.is_empty() && clean_id != "no_id_provided" {
        let chrome_manifest = serde_json::json!({
            "name": "grabix_pro_host",
            "description": "GrabixPro Native Messaging Host",
            "path": native_host_str,
            "type": "stdio",
            "allowed_origins": [format!("chrome-extension://{}/", clean_id)]
        });
        let body = serde_json::to_string_pretty(&chrome_manifest).map_err(|e| e.to_string())?;
        std::fs::write(&chrome_manifest_path, body).map_err(|e| e.to_string())?;
        chrome_registered = true;
    }

    let firefox_manifest = serde_json::json!({
        "name": "grabix_pro_host",
        "description": "GrabixPro Native Messaging Host",
        "path": native_host_str,
        "type": "stdio",
        "allowed_extensions": ["grabixpro@grabix.pro"]
    });
    let firefox_manifest_path = exe_dir.join("grabix_pro_host_firefox.json");
    let firefox_body = serde_json::to_string_pretty(&firefox_manifest).map_err(|e| e.to_string())?;
    std::fs::write(&firefox_manifest_path, firefox_body).map_err(|e| e.to_string())?;

    // This command is auto-invoked on every startup, so a locked-down registry
    // hive must surface as an error, not a panic that takes the app down.
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let chrome_manifest_str = chrome_manifest_path
            .to_str()
            .ok_or("Invalid Chrome manifest path")?;
        let firefox_manifest_str = firefox_manifest_path
            .to_str()
            .ok_or("Invalid Firefox manifest path")?;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        let register = |sub: &str, value: &str| -> Result<(), String> {
            let (key, _) = hkcu
                .create_subkey(sub)
                .map_err(|e| format!("Could not create registry key {sub}: {e}"))?;
            key.set_value("", &value)
                .map_err(|e| format!("Could not write registry key {sub}: {e}"))
        };

        if chrome_registered {
            register(
                "Software\\Google\\Chrome\\NativeMessagingHosts\\grabix_pro_host",
                chrome_manifest_str,
            )?;
            register(
                "Software\\Microsoft\\Edge\\NativeMessagingHosts\\grabix_pro_host",
                chrome_manifest_str,
            )?;
        }
        register(
            "Software\\Mozilla\\NativeMessagingHosts\\grabix_pro_host",
            firefox_manifest_str,
        )?;
    }

    Ok("SUCCESS: Extension manifests updated.".to_string())
}

#[tauri::command]
pub fn check_extension_status() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        Ok(hkcu.open_subkey("Software\\Mozilla\\NativeMessagingHosts\\grabix_pro_host").is_ok())
    }
    #[cfg(not(target_os = "windows"))]
    Ok(false)
}

#[tauri::command]
pub fn log_error(app_handle: AppHandle, message: String) {
    let Ok(dir) = app_handle.path().app_data_dir() else { return };
    let _ = std::fs::create_dir_all(&dir);
    let log_path = dir.join("error_log.json");
    let entry = LogEntry { timestamp: Local::now().to_rfc3339(), message };
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        use std::io::Write;
        if let Ok(json) = serde_json::to_string(&entry) { let _ = writeln!(file, "{}", json); }
    }
}

/// Live yt-dlp processes, keyed by the frontend's download id.
///
/// Cancellation used to be `taskkill /IM yt-dlp.exe`, a name-based kill that took
/// down every yt-dlp on the machine — including the *other* concurrent Grabix
/// downloads and any unrelated yt-dlp the user was running. Tracking the pids we
/// actually spawned lets us cancel exactly one download, and lets "stop all" stay
/// scoped to our own children.
#[derive(Default)]
pub struct DownloadRegistry(pub Mutex<HashMap<String, u32>>);

impl DownloadRegistry {
    fn insert(&self, id: &str, pid: u32) {
        if let Ok(mut map) = self.0.lock() {
            map.insert(id.to_string(), pid);
        }
    }

    fn remove(&self, id: &str) {
        if let Ok(mut map) = self.0.lock() {
            map.remove(id);
        }
    }

    fn pid_of(&self, id: &str) -> Option<u32> {
        self.0.lock().ok()?.get(id).copied()
    }

    fn drain_pids(&self) -> Vec<u32> {
        match self.0.lock() {
            Ok(mut map) => map.drain().map(|(_, pid)| pid).collect(),
            Err(_) => vec![],
        }
    }
}

/// Kills a process tree by pid. /T takes the spawned ffmpeg child with it.
fn kill_pid(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string(), "/T"])
            .creation_flags(0x08000000)
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .spawn();
    }
}

/// Cancels a single download without touching the others.
#[tauri::command]
pub async fn cancel_download(app_handle: AppHandle, id: String) -> Result<(), String> {
    let registry = app_handle.state::<DownloadRegistry>();
    match registry.pid_of(&id) {
        Some(pid) => {
            kill_pid(pid);
            registry.remove(&id);
            Ok(())
        }
        // Already finished or never started — nothing to kill, and that's fine.
        None => Ok(()),
    }
}

// NOTE: `VideoInfo`/`Format` structs used to live here but were never constructed —
// analyze_url returns raw serde_json::Value straight through to the frontend,
// which owns the typed shape in src/types.ts.

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct HistoryEntry {
    /// Download id, so a running entry can be cancelled individually. Without
    /// this field here, the id would be dropped on every save round-trip.
    pub id: Option<String>,
    pub title: String,
    pub url: String,
    pub timestamp: String,
    pub path: Option<String>,
    pub status: Option<String>,
    pub progress: Option<f64>,
    pub speed: Option<String>,
    pub eta: Option<String>,
}

/// Every field carries a default. Without this, adding a single new setting made
/// old settings.json files fail to deserialize, which sent the frontend down its
/// error path and let the next save overwrite the user's real history and save
/// path with in-memory defaults. Missing fields now fill in silently instead.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub auto_advance: bool,
    pub auto_paste: bool,
    pub show_activity: bool,
    pub dl_subtitles: bool,
    pub show_thumbnail: bool,
    pub auto_open_folder: bool,
    pub concurrent_downloads: u32,
    pub default_resolution: String,
    pub history: Vec<HistoryEntry>,
    pub save_path: String,
    pub playlist_download: bool,
    /// Browser to lift cookies from ("" = off). Unlocks age-restricted,
    /// private and members-only videos by reusing the user's own session.
    pub cookies_from_browser: String,
    /// yt-dlp --limit-rate value, e.g. "2M" ("" = unlimited).
    pub limit_rate: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_advance: true,
            auto_paste: false,
            show_activity: true,
            dl_subtitles: false,
            show_thumbnail: true,
            auto_open_folder: true,
            concurrent_downloads: 1,
            default_resolution: "custom".to_string(),
            history: vec![],
            save_path: String::new(),
            playlist_download: false,
            cookies_from_browser: String::new(),
            limit_rate: String::new(),
        }
    }
}

fn settings_path(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data dir: {e}"))
        .map(|d| d.join("settings.json"))
}

/// Writes to a temp file and renames over the target. A bare `fs::write` truncates
/// the live file first, so a crash mid-write left a half-written settings.json —
/// which then failed to load and cost the user their history.
#[tauri::command]
pub fn save_settings(app_handle: AppHandle, settings: Settings) -> Result<(), String> {
    let config_path = settings_path(&app_handle)?;
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;

    let tmp_path = config_path.with_extension("json.tmp");
    std::fs::write(&tmp_path, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &config_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        e.to_string()
    })?;

    Ok(())
}

#[tauri::command]
pub fn load_settings(app_handle: AppHandle) -> Result<Settings, String> {
    let config_path = settings_path(&app_handle)?;
    if !config_path.exists() {
        return Ok(Settings::default());
    }

    let content = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;

    match serde_json::from_str::<Settings>(&content) {
        Ok(settings) => Ok(settings),
        Err(e) => {
            // Unparseable (truncated by an old non-atomic write, hand-edited, …).
            // Preserve it instead of letting the next save silently clobber it,
            // so the user's history is recoverable.
            let backup = config_path.with_extension("json.corrupt");
            let _ = std::fs::rename(&config_path, &backup);
            log_error(
                app_handle,
                format!("settings.json was unreadable ({e}); backed up to {backup:?} and reset to defaults."),
            );
            Ok(Settings::default())
        }
    }
}

#[tauri::command]
pub fn check_path_exists(path: String) -> bool {
    let clean_path = path.trim_matches('"').replace('/', "\\");
    std::path::Path::new(&clean_path).exists()
}

#[tauri::command]
pub async fn analyze_url(app_handle: AppHandle, url: String) -> Result<serde_json::Value, String> {
    let ytdlp_path = get_ytdlp_path(&app_handle);
    let settings = load_settings(app_handle.clone()).unwrap_or_default();

    let mut cmd = Command::new(ytdlp_path);
    cmd.env("PYTHONUTF8", "1");
    cmd.arg("-J");
    if !settings.playlist_download { cmd.arg("--no-playlist"); } else { cmd.arg("--flat-playlist"); }
    
    // Add headers for better compatibility
    cmd.arg("--add-header").arg("Referer:https://www.facebook.com/");
    cmd.arg("--user-agent").arg("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");

    // Age-restricted / private videos fail at analysis too, not just download.
    if !settings.cookies_from_browser.is_empty() {
        cmd.arg("--cookies-from-browser").arg(&settings.cookies_from_browser);
    }

    cmd.arg(&url).stdout(Stdio::piped()).stderr(Stdio::piped());
    
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd.output().await.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let info: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    let is_playlist = info.get("_type").and_then(|t| t.as_str()) == Some("playlist");

    if is_playlist && settings.playlist_download {
        let ytdlp_path_playlist = get_ytdlp_path(&app_handle);
        let url_playlist = url.clone();
        let app_handle_playlist = app_handle.clone();
        
        tokio::spawn(async move {
            let mut cmd = Command::new(ytdlp_path_playlist);
            cmd.arg("--get-info").arg("--flat-playlist").arg("--dump-json").arg(&url_playlist).stdout(Stdio::piped());
            #[cfg(target_os = "windows")]
            cmd.creation_flags(0x08000000);
            
            if let Ok(mut child) = cmd.spawn() {
                let stdout = child.stdout.take().unwrap();
                let mut reader = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    if let Ok(entry_json) = serde_json::from_str::<serde_json::Value>(&line) {
                        let _ = app_handle_playlist.emit("playlist-entry", entry_json);
                    }
                }
            }
        });
    }
    Ok(info)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub status: String,
    pub title: Option<String>,
    pub url: Option<String>,
    pub progress: Option<f64>,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub path: Option<String>,
}

/// The app's real version, straight from the bundle manifest, so the About tab
/// can't drift out of sync with tauri.conf.json the way a hardcoded string did.
#[tauri::command]
pub fn get_app_version(app_handle: AppHandle) -> String {
    app_handle.package_info().version.to_string()
}

/// Current version string of the bundled yt-dlp binary.
#[tauri::command]
pub async fn get_ytdlp_version(app_handle: AppHandle) -> Result<String, String> {
    let ytdlp_path = get_ytdlp_path(&app_handle);

    let mut cmd = Command::new(ytdlp_path);
    cmd.arg("--version").stdout(Stdio::piped()).stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd.output().await.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Self-updates yt-dlp in place via `yt-dlp -U`. The binary lives in the
/// user-writable app data dir (see `deps::get_deps_dir`), so this needs no
/// elevation. Returns yt-dlp's own report, which already distinguishes
/// "up to date" from "updated to <version>".
#[tauri::command]
pub async fn update_ytdlp(app_handle: AppHandle) -> Result<String, String> {
    let ytdlp_path = get_ytdlp_path(&app_handle);

    let mut cmd = Command::new(ytdlp_path);
    cmd.arg("-U").stdout(Stdio::piped()).stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd.output().await.map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let msg = if stderr.is_empty() { stdout } else { stderr };
        return Err(if msg.is_empty() {
            "yt-dlp update failed.".to_string()
        } else {
            msg
        });
    }

    // yt-dlp reports progress on stdout; fall back to stderr if it stayed quiet.
    Ok(if stdout.is_empty() { stderr } else { stdout })
}

/// Stops only the downloads this app spawned — see [`DownloadRegistry`] for why
/// this is no longer a machine-wide `taskkill /IM yt-dlp.exe`.
#[tauri::command]
pub async fn stop_all_downloads(app_handle: AppHandle) -> Result<(), String> {
    for pid in app_handle.state::<DownloadRegistry>().drain_pids() {
        kill_pid(pid);
    }
    Ok(())
}

#[tauri::command]
pub async fn start_download(
    app_handle: AppHandle,
    id: String,
    url: String,
    format_id: String,
    save_path: String,
    dl_subtitles: bool,
    title: Option<String>,
    // `section` is `*START-END` in seconds (yt-dlp --download-sections), or None
    // for the whole video.
    section: Option<String>,
) -> Result<(), String> {
    // Cookie source and rate limit are user preferences, read here rather than
    // threaded through every call site.
    let prefs = load_settings(app_handle.clone()).unwrap_or_default();
    let cookies_browser = prefs.cookies_from_browser.clone();
    let limit_rate = prefs.limit_rate.clone();
    let ytdlp_path = get_ytdlp_path(&app_handle);
    let ffmpeg_path = get_ffmpeg_path(&app_handle);
    let ffmpeg_dir = ffmpeg_path
        .parent()
        .and_then(|p| p.to_str())
        .ok_or("Could not resolve the bundled ffmpeg directory")?
        .to_string();

    let actual_save_path = if save_path.is_empty() {
        app_handle
            .path()
            .download_dir()
            .map_err(|e| e.to_string())?
            .to_str()
            .ok_or("Downloads folder path is not valid UTF-8")?
            .to_string()
    } else {
        save_path
    };

    let run_dl = |with_subs: bool, fid: &str, target_url: &str| {
        let mut cmd = Command::new(&ytdlp_path);
        cmd.arg("--ffmpeg-location").arg(&ffmpeg_dir);
        
        // Force UTF-8 for Python to avoid [Errno 22] cp1252 encoding errors on Windows
        cmd.env("PYTHONUTF8", "1");
        
        // Robustness options
        cmd.arg("--no-mtime");
        cmd.arg("--windows-filenames"); // Strip illegal characters
        cmd.arg("--restrict-filenames"); // Be even more strict to avoid Errno 22

        // Machine-readable progress and final path, instead of scraping yt-dlp's
        // human-readable stdout. The old parser split on whitespace looking for a
        // "%" and guessed the output path from six different English log phrases —
        // both of which the in-app yt-dlp updater could break at any time.
        // These template fields are part of yt-dlp's documented interface.
        cmd.arg("--progress-template")
            .arg("download:GRABIXPROG\t%(progress._percent_str)s\t%(progress._speed_str)s\t%(progress._eta_str)s");
        // A `WHEN:` prefix keeps --print from implying --simulate/--quiet.
        cmd.arg("--print").arg("after_move:GRABIXPATH\t%(filepath)s");

        // Add headers to avoid some site blocks (especially Facebook/Instagram)
        cmd.arg("--add-header").arg("Referer:https://www.facebook.com/");
        cmd.arg("--user-agent").arg("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");

        // Standardize on MP4 output
        cmd.arg("--merge-output-format").arg("mp4");
        cmd.arg("--postprocessor-args").arg("ffmpeg:-movflags +faststart");
        
        // Parse format keywords
        let parts: Vec<&str> = fid.split("__").collect();
        let base_fid = parts[0];

        if base_fid == "mp3" {
            cmd.arg("-f").arg("bestaudio/best").arg("--extract-audio").arg("--audio-format").arg("mp3");
        } else if base_fid == "aac_audio" {
            cmd.arg("-f").arg("bestaudio[ext=m4a]/best").arg("--audio-format").arg("m4a");
        } else {
            // Prefer MP4/M4A to avoid re-encoding
            cmd.arg("--format-sort").arg("res,ext:mp4:m4a");

            let format_string = if base_fid == "best" || base_fid.is_empty() {
                "bestvideo+bestaudio/best".to_string()
            } else if !base_fid.contains('/') {
                format!("{}/bestvideo+bestaudio/best", base_fid)
            } else {
                base_fid.to_string()
            };
            cmd.arg("-f").arg(format_string);
            
            // Remux to MP4 instead of recoding to avoid encoding errors and be faster
            cmd.arg("--remux-video").arg("mp4");
        }

        // Reuse the user's browser session for age-restricted / private / members-only videos.
        if !cookies_browser.is_empty() {
            cmd.arg("--cookies-from-browser").arg(&cookies_browser);
        }

        // Bandwidth cap, e.g. "2M".
        if !limit_rate.is_empty() {
            cmd.arg("--limit-rate").arg(&limit_rate);
        }

        // Clip a section out of the video. --force-keyframes-at-cuts makes the cut
        // land exactly where the user asked instead of on the nearest keyframe.
        if let Some(sec) = section.as_deref().filter(|s| !s.is_empty()) {
            cmd.arg("--download-sections").arg(sec);
            cmd.arg("--force-keyframes-at-cuts");
        }

        // Handle long file names by trimming the title part to 80 characters
        cmd.arg("-o").arg(format!("{}/%(title).80s.%(ext)s", actual_save_path));
        cmd.arg("--no-playlist").arg("--newline");

        if with_subs {
            cmd.arg("--write-sub").arg("--write-auto-sub");
            // Plain "en" avoids pulling en-US/en-GB/en-orig as duplicate tracks.
            cmd.arg("--sub-langs").arg("en");
            cmd.arg("--sub-format").arg("vtt/best");
        }
        cmd.arg(target_url).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        cmd.spawn()
    };

    let mut child = run_dl(dl_subtitles, &format_id, &url).map_err(|e| e.to_string())?;

    // Register the pid so cancel_download/stop_all_downloads can target exactly
    // this download.
    if let Some(pid) = child.id() {
        app_handle.state::<DownloadRegistry>().insert(&id, pid);
    }

    let stdout = child.stdout.take().ok_or("Failed to capture yt-dlp stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture yt-dlp stderr")?;
    let url_inner = url.clone();
    let title_inner = title.clone();
    
    let shared_path = Arc::new(Mutex::new(None));
    let shared_path_clone = shared_path.clone();
    let actual_save_path_clone = actual_save_path.clone();
    // Once yt-dlp tells us the real path via --print, stop letting the legacy
    // log-phrase guesses overwrite it.
    let path_is_authoritative = Arc::new(Mutex::new(false));
    let path_is_authoritative_clone = path_is_authoritative.clone();

    // Spawn thread to read stderr and collect error messages
    let error_log = Arc::new(Mutex::new(String::new()));
    let error_log_clone = error_log.clone();
    let app_handle_stderr = app_handle.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let mut log = error_log_clone.lock().unwrap();
            log.push_str(&line);
            log.push('\n');
            // Also emit log to UI if needed
            let _ = app_handle_stderr.emit("download-log", line);
        }
    });

    let app_handle_stdout = app_handle.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            // --- authoritative, template-driven output ---------------------

            if let Some(rest) = line.strip_prefix("GRABIXPATH\t") {
                let p = rest.trim();
                if !p.is_empty() {
                    *shared_path_clone.lock().unwrap() = Some(p.to_string());
                    *path_is_authoritative_clone.lock().unwrap() = true;
                }
                continue;
            }

            if let Some(rest) = line.strip_prefix("GRABIXPROG\t") {
                let mut f = rest.split('\t');
                // "_percent_str" is like " 42.3%"; "Unknown" fields are passed
                // through verbatim by yt-dlp, so parsing simply yields None.
                let progress = f
                    .next()
                    .and_then(|s| s.trim().trim_end_matches('%').parse::<f64>().ok());
                let speed = f.next().map(str::trim).filter(|s| !s.starts_with("Unknown")).map(str::to_string);
                let eta = f.next().map(str::trim).filter(|s| !s.starts_with("Unknown")).map(str::to_string);

                let p_val = { shared_path_clone.lock().unwrap().clone() };

                let _ = app_handle_stdout.emit("download-progress", DownloadProgress {
                    status: "downloading".to_string(),
                    title: title_inner.clone(),
                    url: Some(url_inner.clone()),
                    progress,
                    speed,
                    eta,
                    path: p_val,
                });
                continue;
            }

            // --- legacy fallback -------------------------------------------
            // Only used until `after_move:filepath` fires (and for the
            // "already downloaded" case, where it never does).
            if *path_is_authoritative_clone.lock().unwrap() {
                continue;
            }

            let mut current_path = None;

            if line.contains("Destination:") {
                if let Some(p) = line.split("Destination: ").nth(1) {
                    current_path = Some(p.trim().trim_matches('"').to_string());
                }
            } else if line.contains("has already been downloaded") {
                if let Some(p) = line.split("[download] ").nth(1).and_then(|s| s.split(" has already").next()) {
                    current_path = Some(p.trim().trim_matches('"').to_string());
                }
            } else if line.contains("Merging formats into") {
                if let Some(p) = line.split("into ").nth(1) {
                    current_path = Some(p.trim().trim_matches('"').to_string());
                }
            } else if line.contains("Deleting original file") {
                if let Some(p) = line.split("file ").nth(1) {
                    current_path = Some(p.trim().trim_matches('"').to_string());
                }
            } else if (line.contains("Fixup") || line.contains("Adding metadata")) && line.contains(" of ") {
                if let Some(p) = line.split(" of ").nth(1) {
                    let name = p.trim().trim_matches('"');
                    let mut path_buf = std::path::PathBuf::from(name);
                    if !path_buf.is_absolute() {
                        let mut base = std::path::PathBuf::from(&actual_save_path_clone);
                        base.push(name);
                        path_buf = base;
                    }
                    current_path = Some(path_buf.to_string_lossy().to_string());
                }
            } else if line.contains("Adding metadata to") {
                if let Some(p) = line.split("to ").nth(1) {
                    current_path = Some(p.trim().trim_matches('"').to_string());
                }
            }

            if let Some(p) = current_path {
                // Ensure we don't store .part paths
                if !p.ends_with(".part") && !p.ends_with(".ytdl") {
                    let mut guard = shared_path_clone.lock().unwrap();
                    *guard = Some(p);
                }
            }

        }
    });

    let mut final_status = child.wait().await.map_err(|e| e.to_string())?;

    // A user cancel kills the process, which surfaces here as a non-zero exit.
    // Treat a cancelled download as cancelled, not as a subtitle failure to retry
    // and not as an error to report.
    let was_cancelled =
        !final_status.success() && app_handle.state::<DownloadRegistry>().pid_of(&id).is_none();

    if was_cancelled {
        return Ok(());
    }

    if !final_status.success() && dl_subtitles {
        let mut retry_child = run_dl(false, &format_id, &url).map_err(|e| e.to_string())?;
        if let Some(pid) = retry_child.id() {
            app_handle.state::<DownloadRegistry>().insert(&id, pid);
        }
        let retry_stderr = retry_child.stderr.take().ok_or("Failed to capture yt-dlp stderr")?;
        let error_log_retry = error_log.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(retry_stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let mut log = error_log_retry.lock().unwrap();
                log.push_str(&line);
                log.push('\n');
            }
        });
        final_status = retry_child.wait().await.map_err(|e| e.to_string())?;

        if !final_status.success()
            && app_handle.state::<DownloadRegistry>().pid_of(&id).is_none()
        {
            return Ok(());
        }
    }

    // Past this point the process is done; stop tracking it either way.
    app_handle.state::<DownloadRegistry>().remove(&id);

    if !final_status.success() {
        let err_msg = {
            let log = error_log.lock().unwrap();
            if log.is_empty() {
                "Download failed. Check your internet connection or try a different format.".to_string()
            } else {
                // Return last 2 lines of error log for conciseness in UI
                let lines: Vec<&str> = log.lines().collect();
                let last_lines = if lines.len() > 2 {
                    format!("...\n{}", lines[lines.len()-2..].join("\n"))
                } else {
                    log.clone()
                };
                format!("Download failed: {}", last_lines)
            }
        };

        let _ = app_handle.emit("download-progress", DownloadProgress {
            status: "error".to_string(), title: title, url: Some(url),
            progress: None, speed: None, eta: None,
            path: None,
        });
        return Err(err_msg);
    }

    let p_val = { shared_path.lock().unwrap().clone().unwrap_or_else(|| actual_save_path.clone()) };

    let _ = app_handle.emit("download-progress", DownloadProgress {
        status: "finished".to_string(), title: title, url: Some(url),
        progress: Some(100.0), speed: None, eta: None,
        path: Some(p_val),
    });

    Ok(())
}
