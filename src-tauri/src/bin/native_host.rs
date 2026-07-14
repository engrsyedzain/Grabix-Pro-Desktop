// GrabixPro Native Messaging Host
// ---------------------------------
// A lightweight standalone binary that acts as the bridge between the browser
// extension and the main GrabixPro Tauri application.
//
// Communication flow:
//   Browser Extension  -->  [stdin: length-prefixed JSON]  -->  this binary
//   this binary         -->  launches GrabixPro.exe with URL arg (or signals running instance)
//   this binary         -->  [stdout: length-prefixed JSON] -->  Browser Extension
//
// This binary intentionally does NOT use `#![windows_subsystem = "windows"]`
// because Native Messaging requires functional stdin/stdout handles.

use std::io::{self, Read, Write};
use std::path::PathBuf;

/// Read a single Native Messaging message from stdin.
/// Native Messaging protocol: 4-byte LE length prefix followed by UTF-8 JSON.
fn read_message() -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let mut length_bytes = [0u8; 4];
    io::stdin().read_exact(&mut length_bytes)?;
    let length = u32::from_le_bytes(length_bytes) as usize;

    // Sanity check: Chrome enforces 1MB max, but we cap at 4MB for safety
    if length > 4 * 1024 * 1024 {
        return Err(format!("Message too large: {} bytes", length).into());
    }

    let mut buffer = vec![0u8; length];
    io::stdin().read_exact(&mut buffer)?;

    let message: serde_json::Value = serde_json::from_slice(&buffer)?;
    Ok(message)
}

/// Write a Native Messaging response to stdout.
/// Encodes as 4-byte LE length prefix + UTF-8 JSON.
fn write_message(msg: &serde_json::Value) -> Result<(), Box<dyn std::error::Error>> {
    let serialized = serde_json::to_string(msg)?;
    let bytes = serialized.as_bytes();
    let length = bytes.len() as u32;

    let mut stdout = io::stdout().lock();
    stdout.write_all(&length.to_le_bytes())?;
    stdout.write_all(bytes)?;
    stdout.flush()?;
    Ok(())
}

/// Locate the main GrabixPro executable.
/// The native host binary sits next to the main app in the same directory.
fn find_main_executable() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let self_path = std::env::current_exe()?;
    let exe_dir = self_path.parent().ok_or("Cannot determine executable directory")?;

    #[cfg(target_os = "windows")]
    let possible_exes = ["grabix-pro.exe", "GrabixPro.exe"];
    #[cfg(target_os = "macos")]
    let possible_exes = ["grabix-pro", "GrabixPro"];
    #[cfg(target_os = "linux")]
    let possible_exes = ["grabix-pro", "GrabixPro"];

    for exe_name in possible_exes {
        let path = exe_dir.join(exe_name);
        if path.exists() {
            return Ok(path);
        }
    }

    Err(format!("Main executable not found in {:?}", exe_dir).into())
}

/// Append a debug log line to a file in the temp directory.
fn debug_log(message: &str) {
    let log_path = std::env::temp_dir().join("grabix_native_host.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(file, "[{}] {}", timestamp, message);
    }
}

fn main() {
    debug_log(&format!(
        "Native host started. Args: {:?}",
        std::env::args().collect::<Vec<_>>()
    ));

    // Process messages in a loop (Chrome may send multiple before closing stdin)
    loop {
        let message = match read_message() {
            Ok(msg) => msg,
            Err(e) => {
                debug_log(&format!("Failed to read message (stream likely closed): {}", e));
                break;
            }
        };

        debug_log(&format!("Received message: {}", message));

        // Handle ping/health-check messages
        if message.get("action").and_then(|a| a.as_str()) == Some("ping") {
            let response = serde_json::json!({
                "status": "ok",
                "action": "pong",
                "version": env!("CARGO_PKG_VERSION")
            });
            if let Err(e) = write_message(&response) {
                debug_log(&format!("Failed to write pong response: {}", e));
            }
            continue;
        }

        // Extract URL from the message
        let url = match message.get("url").and_then(|u| u.as_str()) {
            Some(u) => u.to_string(),
            None => {
                let response = serde_json::json!({
                    "status": "error",
                    "message": "No 'url' field in message"
                });
                let _ = write_message(&response);
                continue;
            }
        };

        // Extract optional metadata
        let title = message
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();

        let resolution = message
            .get("resolution")
            .and_then(|r| r.as_str())
            .unwrap_or("720p")
            .to_string();

        let mode = message
            .get("mode")
            .and_then(|m| m.as_str())
            .unwrap_or("silent")
            .to_string();

        let payload_json = serde_json::json!({
            "url": url,
            "title": title,
            "resolution": resolution,
            "mode": mode
        });
        
        let payload_str = serde_json::to_string(&payload_json).unwrap_or_else(|_| "{}".to_string());

        debug_log(&format!("Processing URL: {} with payload: {}", url, payload_str));

        // Launch the main GrabixPro application with the URL
        let launch_result = match find_main_executable() {
            Ok(exe_path) => {
                debug_log(&format!("Launching: {:?} with url: {}", exe_path, url));

                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    std::process::Command::new(&exe_path)
                        .arg("--payload")
                        .arg(&payload_str)
                        .creation_flags(0x00000008) // DETACHED_PROCESS
                        .spawn()
                }
                #[cfg(not(target_os = "windows"))]
                {
                    std::process::Command::new(&exe_path)
                        .arg("--payload")
                        .arg(&payload_str)
                        .spawn()
                }
            }
            Err(e) => {
                let response = serde_json::json!({
                    "status": "error",
                    "message": format!("Cannot find GrabixPro: {}", e)
                });
                let _ = write_message(&response);
                debug_log(&format!("Cannot find main exe: {}", e));
                continue;
            }
        };

        let response = match launch_result {
            Ok(_) => {
                debug_log("GrabixPro launched successfully");
                serde_json::json!({
                    "status": "ok",
                    "message": "URL sent to GrabixPro",
                    "url": url
                })
            }
            Err(e) => {
                debug_log(&format!("Failed to launch GrabixPro: {}", e));
                serde_json::json!({
                    "status": "error",
                    "message": format!("Failed to launch GrabixPro: {}", e)
                })
            }
        };

        if let Err(e) = write_message(&response) {
            debug_log(&format!("Failed to write response: {}", e));
            break;
        }
    }

    debug_log("Native host exiting");
}
