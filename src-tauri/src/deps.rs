//! Where the app's binaries live on disk.
//!
//! Nothing is bundled any more - yt-dlp, ffmpeg and ffprobe are all fetched at
//! runtime into this user-writable directory. See `engine.rs` for why, and for
//! the downloads themselves. This module is just the agreed-upon paths, kept
//! separate so both the provisioner and the callers that spawn the binaries
//! resolve them the same way.

use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

pub fn get_deps_dir(app_handle: &AppHandle) -> PathBuf {
    let mut path = app_handle.path().app_data_dir().expect("failed to get app data dir");
    path.push("bin");
    if !path.exists() {
        fs::create_dir_all(&path).expect("failed to create bin dir");
    }
    path
}

pub fn get_ytdlp_path(app_handle: &AppHandle) -> PathBuf {
    let mut path = get_deps_dir(app_handle);
    #[cfg(target_os = "windows")]
    path.push("yt-dlp.exe");
    #[cfg(not(target_os = "windows"))]
    path.push("yt-dlp");
    path
}

pub fn get_ffmpeg_path(app_handle: &AppHandle) -> PathBuf {
    let mut path = get_deps_dir(app_handle);
    #[cfg(target_os = "windows")]
    path.push("ffmpeg.exe");
    #[cfg(not(target_os = "windows"))]
    path.push("ffmpeg");
    path
}

pub fn get_ffprobe_path(app_handle: &AppHandle) -> PathBuf {
    let mut path = get_deps_dir(app_handle);
    #[cfg(target_os = "windows")]
    path.push("ffprobe.exe");
    #[cfg(not(target_os = "windows"))]
    path.push("ffprobe");
    path
}
