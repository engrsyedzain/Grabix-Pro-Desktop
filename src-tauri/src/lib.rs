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
            // Holds a cold-start launch request until the frontend can receive it.
            app.manage(commands::PendingLaunch::default());

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
                    // Step in whole 10% increments (0, 10, 20 ...) rather than by
                    // drift since the last update, which produced arbitrary values
                    // like 7% -> 17% -> 26% and rewrote the tray constantly.
                    let step = (progress / 10.0).floor() * 10.0;

                    {
                        let mut lp = last_progress.lock().unwrap();
                        // Only redraw when a new 10% step is crossed, or on a status change.
                        if (step - *lp).abs() < f64::EPSILON && payload.status == "downloading" {
                            return;
                        }
                        *lp = step;
                    }

                    let title = payload.title.clone().unwrap_or_else(|| "Video".to_string());
                    let text = match payload.status.as_str() {
                        "downloading" => format!("{}: {}%", title, step as u32),
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

            // Handle initial launch arguments.
            //
            // Cold start only: `setup` runs before the webview's JS exists, so the
            // frontend has not registered its listeners yet. Emitting here would
            // broadcast to nobody and the download request would vanish - which is
            // exactly what happened when the extension launched a closed app. Park
            // it instead; the frontend calls `flush_pending_launch` once its
            // listeners are attached, and only then does it get emitted.
            let args: Vec<String> = std::env::args().collect();
            commands::launch_log(app.handle(), &format!("cold start args: {:?}", args));
            match parse_launch(&args) {
                Some(launch) => {
                    commands::launch_log(
                        app.handle(),
                        &format!("cold start: parking '{}' payload={}", launch.event, launch.payload),
                    );
                    if !launch.is_silent {
                        show_main_window(app.handle());
                    }
                    if let Ok(mut pending) = app.state::<commands::PendingLaunch>().0.lock() {
                        *pending = Some((launch.event.to_string(), launch.payload));
                    }
                }
                None => commands::launch_log(app.handle(), "cold start: no launch request in args"),
            }

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
            commands::cancel_download,
            commands::flush_pending_launch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// What a set of launch arguments asks the app to do.
pub struct Launch {
    pub event: &'static str,
    pub payload: String,
    pub is_silent: bool,
}

/// Parse the arguments the native host (or a manual launch) passed us.
/// Pure: it decides nothing about delivery, because cold and warm starts must
/// deliver differently. See `handle_args` and the `setup` hook.
fn parse_launch(args: &[String]) -> Option<Launch> {
    // Reconstruct payload by joining all args after --payload
    if let Some(idx) = args.iter().position(|a| a == "--payload") {
        let payload = args[idx + 1..].join(" ");
        let is_silent = serde_json::from_str::<serde_json::Value>(&payload)
            .ok()
            .and_then(|v| {
                v.get("mode")
                    .and_then(|m| m.as_str())
                    .map(|mode| mode == "silent")
            })
            .unwrap_or(false);

        return Some(Launch {
            event: "silent-download-request",
            payload,
            is_silent,
        });
    }

    // Fallback to old URL logic
    let url = if let Some(sep_pos) = args.iter().position(|a| a == "--") {
        args.get(sep_pos + 1).cloned()
    } else {
        args.get(1).cloned()
    }?;

    if url.starts_with("http://") || url.starts_with("https://") {
        Some(Launch {
            event: "download-url",
            payload: url,
            is_silent: false,
        })
    } else {
        None
    }
}

fn show_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Second-launch path (single-instance): the window and its JS are already up,
/// so the listeners exist and emitting reaches them.
fn handle_args<R: Runtime>(app: &tauri::AppHandle<R>, args: Vec<String>) {
    let Some(launch) = parse_launch(&args) else {
        commands::launch_log(app, "second instance: no launch request in args");
        return;
    };

    if !launch.is_silent {
        show_main_window(app);
    }

    let result = app.emit(launch.event, &launch.payload);
    commands::launch_log(
        app,
        &format!(
            "second instance: emitted '{}' ok={} payload={}",
            launch.event,
            result.is_ok(),
            launch.payload
        ),
    );
}
