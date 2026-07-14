use std::path::{PathBuf};
use std::fs;
use std::io::{copy, Cursor};
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

/// Runs `<binary> --version`. yt-dlp versions are `YYYY.MM.DD`, so the returned
/// strings order correctly under a plain lexicographic compare.
async fn ytdlp_version(path: &std::path::Path) -> Option<String> {
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
    if v.is_empty() { None } else { Some(v) }
}

pub async fn check_and_download_deps(app_handle: AppHandle) -> anyhow::Result<()> {
    log_setup(&app_handle, "Starting dependency check...");

    let ytdlp_path = get_ytdlp_path(&app_handle);
    let ffmpeg_path = get_ffmpeg_path(&app_handle);
    let ffprobe_path = get_ffprobe_path(&app_handle);

    log_setup(&app_handle, &format!("YT-DLP path: {:?}", ytdlp_path));

    // Ensure yt-dlp
    if !ytdlp_path.exists() {
        log_setup(&app_handle, "yt-dlp missing, looking for sidecar...");
        if let Some(sidecar_path) = find_sidecar(&app_handle, "yt-dlp").await {
            log_setup(&app_handle, &format!("Copying yt-dlp sidecar from {:?}", sidecar_path));
            fs::copy(&sidecar_path, &ytdlp_path)?;
        } else {
            log_setup(&app_handle, "yt-dlp sidecar not found, downloading fallback...");
            let url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
            let response = reqwest::get(url).await?;
            let mut content = Cursor::new(response.bytes().await?);
            let mut file = fs::File::create(&ytdlp_path)?;
            copy(&mut content, &mut file)?;
        }

        #[cfg(not(target_os = "windows"))]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&ytdlp_path)?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&ytdlp_path, perms)?;
        }
    } else if let Some(sidecar_path) = find_sidecar(&app_handle, "yt-dlp").await {
        // yt-dlp already lives in app data. It used to be left alone forever, so a
        // freshly-installed app that shipped a newer engine still ran the stale copy
        // from the previous install — which is exactly the "old version detected"
        // symptom. Upgrade it when the bundled sidecar is newer.
        //
        // Strictly newer, never equal-or-older: the in-app updater (`yt-dlp -U`) can
        // legitimately push the installed copy ahead of what we bundle, and clobbering
        // that on every launch would silently downgrade the user.
        let installed = ytdlp_version(&ytdlp_path).await;
        let bundled = ytdlp_version(&sidecar_path).await;

        match (&installed, &bundled) {
            (Some(cur), Some(new)) if new.as_str() > cur.as_str() => {
                log_setup(
                    &app_handle,
                    &format!("Upgrading yt-dlp {cur} -> {new} from bundled sidecar."),
                );
                if let Err(e) = fs::copy(&sidecar_path, &ytdlp_path) {
                    // Most likely the old binary is still running; next launch retries.
                    log_setup(&app_handle, &format!("yt-dlp upgrade failed: {e}"));
                }
            }
            (Some(cur), Some(new)) => {
                log_setup(&app_handle, &format!("yt-dlp {cur} is current (bundled {new})."));
            }
            _ => {
                log_setup(&app_handle, "Could not determine yt-dlp versions; leaving as-is.");
            }
        }
    }

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
