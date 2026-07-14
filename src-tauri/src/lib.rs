mod deps;
mod commands;

use tauri::{Emitter, Listener, Manager, Runtime};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use std::sync::{Arc, Mutex};

struct TrayState {
    progress_item: MenuItem<tauri::Wry>,
    last_finished_path: Arc<Mutex<Option<String>>>,
}

fn create_tray_menu(handle: &tauri::AppHandle<tauri::Wry>) -> tauri::Result<(Menu<tauri::Wry>, MenuItem<tauri::Wry>)> {
    let progress_i = MenuItem::with_id(handle, "progress", "No active downloads", false, None::<&str>)?;
    let show_i = MenuItem::with_id(handle, "show", "Show GrabixPro", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(handle, "quit", "Quit GrabixPro", true, None::<&str>)?;
    
    let menu = Menu::with_items(handle, &[
        &progress_i,
        &PredefinedMenuItem::separator(handle)?,
        &show_i,
        &quit_i,
    ])?;
    Ok((menu, progress_i))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            handle_args(app, args);
        }))
        .setup(|app| {
            let handle = app.handle().clone();
            
            let (menu, progress_item) = create_tray_menu(app.handle())?;
            let last_finished_path = Arc::new(Mutex::new(None));
            app.manage(TrayState { progress_item, last_finished_path: last_finished_path.clone() });
            // Tracks the pids of yt-dlp processes we spawn, so downloads can be
            // cancelled individually instead of by a machine-wide taskkill.
            app.manage(commands::DownloadRegistry::default());

            let last_progress = std::sync::Arc::new(std::sync::Mutex::new(-1.0));
            let handle_clone = handle.clone();

            let _tray = TrayIconBuilder::with_id("main_tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    match event {
                        TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } |
                        TrayIconEvent::DoubleClick { button: tauri::tray::MouseButton::Left, .. } => {
                            if let Some(window) = tray.app_handle().get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // Global menu event listener to ensure "show" and "quit" work even after menu updates
            let handle_for_menu = handle.clone();
            handle.on_menu_event(move |app, event| {
                match event.id.as_ref() {
                    "progress" => {
                        let state = app.state::<TrayState>();
                        let path_val = { state.last_finished_path.lock().unwrap().clone() };
                        if let Some(path) = path_val {
                            tauri::async_runtime::spawn(async move {
                                let _ = commands::open_file_location(path).await;
                            });
                        }
                    }
                    "quit" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = commands::stop_all_downloads(app_handle.clone()).await;
                            app_handle.exit(0);
                        });
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                }
            });

            // Listen for progress updates to update the tray menu
            let handle_for_progress = handle_clone.clone();
            handle_clone.listen("download-progress", move |event| {
                let state = handle_for_progress.state::<TrayState>();
                if let Ok(payload) = serde_json::from_str::<commands::DownloadProgress>(event.payload()) {
                    let progress = payload.progress.unwrap_or(0.0);
                    
                    {
                        let mut lp = last_progress.lock().unwrap();
                        // Throttle updates: only update if progress changed by >= 2% or status changed
                        if (progress - *lp).abs() < 2.0 && payload.status == "downloading" {
                            return;
                        }
                        *lp = progress;
                    }

                    let title = payload.title.clone().unwrap_or_else(|| "Video".to_string());
                    let text = match payload.status.as_str() {
                        "downloading" => format!("{}: {}%", title, progress as u32),
                        "finished" => format!("Finished: {}", title),
                        "error" => format!("Error: {}", title),
                        _ => "Processing...".to_string(),
                    };
                    
                    if let Some(tray) = handle_for_progress.tray_by_id("main_tray") {
                        let _ = tray.set_tooltip(Some(text.clone()));
                    }
                    
                    if payload.status == "finished" {
                        if let Some(p) = payload.path {
                            let mut guard = state.last_finished_path.lock().unwrap();
                            *guard = Some(p);
                        }
                        let _ = state.progress_item.set_enabled(true);
                    } else {
                        let _ = state.progress_item.set_enabled(false);
                    }

                    let _ = state.progress_item.set_text(text);
                }
            });

            tauri::async_runtime::spawn(async move {
                if let Err(e) = deps::check_and_download_deps(handle_for_menu).await {
                    eprintln!("Failed to setup dependencies: {}", e);
                }
            });

            // Handle initial launch arguments
            let args: Vec<String> = std::env::args().collect();
            handle_args(app.handle(), args);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::analyze_url,
            commands::start_download,
            commands::log_error,
            commands::stop_all_downloads,
            commands::check_path_exists,
            commands::load_settings,
            commands::save_settings,
            commands::setup_browser_extension,
            commands::check_extension_status,
            commands::open_file_location,
            commands::get_ytdlp_version,
            commands::update_ytdlp,
            commands::get_app_version,
            commands::cancel_download
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn handle_args<R: Runtime>(app: &tauri::AppHandle<R>, args: Vec<String>) {
    let mut payload_str = None;

    // Reconstruct payload by joining all args after --payload
    if let Some(idx) = args.iter().position(|a| a == "--payload") {
        let p = args[idx+1..].join(" ");
        payload_str = Some(p);
    }

    let mut is_silent = false;
    if let Some(p_str) = &payload_str {
        if let Ok(payload_json) = serde_json::from_str::<serde_json::Value>(p_str) {
            if let Some(mode) = payload_json.get("mode").and_then(|m| m.as_str()) {
                if mode == "silent" {
                    is_silent = true;
                }
            }
        }
    }

    // If not silent, show the window
    if !is_silent {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    if let Some(payload) = payload_str {
        let _ = app.emit("silent-download-request", &payload);
    } else {
        // Fallback to old URL logic
        let url = if let Some(sep_pos) = args.iter().position(|a| a == "--") {
            args.get(sep_pos + 1).cloned()
        } else {
            args.get(1).cloned()
        };

        if let Some(url) = url {
            if url.starts_with("http://") || url.starts_with("https://") {
                let _ = app.emit("download-url", &url);
            }
        }
    }
}
