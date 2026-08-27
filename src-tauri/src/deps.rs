//! Where the app's engine binaries live, and how the ones we ship get there.
//!
//! ffmpeg and ffprobe are bundled sidecars: they sit next to the exe after
//! install and are copied once into the user-writable app data dir. yt-dlp is
//! deliberately not one of them - it is fetched fresh by the installer and kept
//! current on every launch. See `engine.rs` for why, and for the download itself.

use std::fs;
use std::io::{copy, Cursor};
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

fn log_setup(app_handle: &AppHandle, message: &str) {
    if let Ok(app_data) = app_handle.path().app_data_dir() {
        let log_path = app_data.join("setup_log.txt");
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let log_message = format!("[{}] {}\n", timestamp, message);
        if let Ok(mut file) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path) {
            use std::io::Write;
            let _ = file.write_all(log_message.as_bytes());
        }
    }
}

async fn find_sidecar(app_handle: &AppHandle, prefix: &str) -> Option<std::path::PathBuf> {
    let exe_path = std::env::current_exe().ok()?;
    let exe_dir = exe_path.parent()?;

    // Potential sidecar locations
    let sidecar_search_dirs = vec![
        exe_dir.to_path_buf(),
        exe_dir.join("binaries"),
        // During development, look in src-tauri/binaries
        exe_dir.join("..").join("..").join("binaries"),
    ];

    for dir in &sidecar_search_dirs {
        log_setup(app_handle, &format!("Searching in: {:?}", dir));
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                #[cfg(target_os = "windows")]
                let is_match = name.starts_with(prefix) && name.ends_with(".exe");
                #[cfg(not(target_os = "windows"))]
                let is_match = name.starts_with(prefix) && !name.contains(".");

                if is_match {
                    log_setup(app_handle, &format!("Found sidecar match: {}", name));
                    return Some(entry.path());
                }
            }
        }
    }
    None
}

/// Copy the bundled sidecars into app data, if they are not already there.
///
/// yt-dlp is handled by `engine::ensure_engine` instead: a copy frozen at build
/// time goes stale within weeks, so the app always fetches the current release
/// rather than seeding itself from a shipped binary.
pub async fn check_and_download_deps(app_handle: AppHandle) -> anyhow::Result<()> {
    log_setup(&app_handle, "Starting dependency check...");

    let ffmpeg_path = get_ffmpeg_path(&app_handle);
    let ffprobe_path = get_ffprobe_path(&app_handle);

    // Ensure FFmpeg
    if !ffmpeg_path.exists() {
        log_setup(&app_handle, "FFmpeg missing, looking for sidecar...");
        if let Some(sidecar_path) = find_sidecar(&app_handle, "ffmpeg").await {
            log_setup(&app_handle, &format!("Copying FFmpeg sidecar from {:?}", sidecar_path));
            fs::copy(&sidecar_path, &ffmpeg_path)?;
        } else {
            #[cfg(target_os = "windows")]
            {
                log_setup(&app_handle, "FFmpeg sidecar not found, downloading fallback...");
                let url = "https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip";
                let response = reqwest::get(url).await?;
                let bytes = response.bytes().await?;
                let mut archive = zip::ZipArchive::new(Cursor::new(bytes))?;
                for i in 0..archive.len() {
                    let mut file = archive.by_index(i)?;
                    if file.name().ends_with("ffmpeg.exe") {
                        let mut out_file = fs::File::create(&ffmpeg_path)?;
                        copy(&mut file, &mut out_file)?;
                        break;
                    }
                }
            }
        }
    }

    // Ensure ffprobe
    if !ffprobe_path.exists() {
        log_setup(&app_handle, "ffprobe missing, looking for sidecar...");
        if let Some(sidecar_path) = find_sidecar(&app_handle, "ffprobe").await {
            log_setup(&app_handle, &format!("Copying ffprobe sidecar from {:?}", sidecar_path));
            fs::copy(&sidecar_path, &ffprobe_path)?;
        }
    }

    log_setup(&app_handle, "Dependency check complete.");
    Ok(())
}
