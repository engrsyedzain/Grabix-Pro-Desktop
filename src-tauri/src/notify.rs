//! Bottom-right desktop notifications for download start/finish.
//!
//! These are drawn in a dedicated always-on-top webview window rather than as
//! native Windows toasts. A Windows toast is styled by the OS: you can set text
//! and an image, but not colour, so the branded start/finish cards the app wants
//! are not expressible as one. Owning the window also means the notification
//! still appears when the main window is hidden to the tray, which is the case
//! that matters most - an extension-triggered download the user never sees.
//!
//! The cost of owning it: these do not land in the Windows Action Center, so a
//! notification missed while the screen was locked is gone.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Runtime, WebviewUrl,
    WebviewWindowBuilder,
};

/// Window label. Also the target of every emit and the key in `capabilities/notify.json`.
const LABEL: &str = "notify";
/// Card width in logical pixels. The frontend is laid out against this.
const WIDTH: f64 = 380.0;
/// Gap between the card stack and the corner of the work area, in logical pixels.
const MARGIN: f64 = 12.0;

/// One card. Everything the notification window draws travels as one of these,
/// on one event.
///
/// Progress ticks deliberately reuse this rather than riding a second, smaller
/// event of their own. The saving from a leaner tick payload is measured in
/// bytes; the cost was a second delivery path that could fail on its own, which
/// is exactly what happened - start and finish cards arrived while every tick
/// vanished silently. One payload on one channel means a tick cannot break
/// without the cards breaking too, and that is a failure nobody can miss.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyPayload {
    /// The download id. Reused across started -> tick -> finished so the frontend
    /// can replace the card in place instead of stacking several for one download.
    pub id: String,
    /// "started" | "finished" | "error"
    pub kind: String,
    pub title: String,
    /// Set on "finished": the file to reveal when the card is clicked.
    pub path: Option<String>,
    /// 0-100 on a progress tick, `None` on the lifecycle events and whenever
    /// yt-dlp reports an unknown percentage.
    #[serde(default)]
    pub progress: Option<f64>,
    /// yt-dlp's own speed string, e.g. "3.21MiB/s".
    #[serde(default)]
    pub speed: Option<String>,
    /// yt-dlp's own ETA string, e.g. "00:42".
    #[serde(default)]
    pub eta: Option<String>,
}

impl NotifyPayload {
    /// A lifecycle card: started, finished or failed.
    pub fn card(id: String, kind: &str, title: String, path: Option<String>) -> Self {
        Self {
            id,
            kind: kind.to_string(),
            title,
            path,
            progress: None,
            speed: None,
            eta: None,
        }
    }

    /// A progress tick for a download already on screen.
    pub fn tick(
        id: String,
        title: String,
        progress: Option<f64>,
        speed: Option<String>,
        eta: Option<String>,
    ) -> Self {
        Self {
            id,
            kind: "started".to_string(),
            title,
            path: None,
            progress,
            speed,
            eta,
        }
    }
}

/// Queues notifications raised before the notification webview has attached its
/// listener.
///
/// Without this, the first notification of a session is silently lost: creating
/// the window returns as soon as the window exists, but its JS has not run yet,
/// so an immediate emit reaches nobody. That is the same failure the cold-start
/// launch payload had (see `PendingLaunch` in commands.rs) and it is worse here,
/// because the very first download of a session is exactly when a notification
/// is raised for the first time - so it would fail every time, not rarely.
#[derive(Default)]
pub struct NotifyState {
    ready: AtomicBool,
    queue: Mutex<Vec<NotifyPayload>>,
}

fn ensure_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }

    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("notification.html".into()))
        .title("Grabix Pro notifications")
        // Built at 1px tall and hidden: the real height is only known once the
        // cards render, and the frontend reports it via `notify_resize`.
        .inner_size(WIDTH, 1.0)
        .visible(false)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        // Never steal focus: a notification must not interrupt typing.
        .focused(false)
        .build()?;

    Ok(())
}

/// Pin the card stack to the bottom-right of the *work area*, not the monitor.
/// The work area excludes the taskbar, so the stack sits above it rather than
/// underneath it.
fn reposition<R: Runtime>(win: &tauri::WebviewWindow<R>) -> tauri::Result<()> {
    let Some(monitor) = win.primary_monitor()? else {
        return Ok(());
    };

    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let size = win.outer_size()?;
    let margin = (MARGIN * scale).round() as i32;

    let x = area.position.x + area.size.width as i32 - size.width as i32 - margin;
    let y = area.position.y + area.size.height as i32 - size.height as i32 - margin;

    win.set_position(PhysicalPosition::new(x, y))
}

/// Note a delivery problem where someone will find it.
///
/// These used to be `let _ = app.emit_to(..)`. Swallowing the result meant a
/// notification that never arrived left no trace anywhere, which turned a
/// one-line bug into a hunt through two languages. Nothing here is fatal - a
/// missed card must never take a download down with it - but it is recorded.
fn log_notify<R: Runtime>(app: &AppHandle<R>, message: &str) {
    eprintln!("notify: {message}");

    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("notify_log.txt"))
    {
        use std::io::Write;
        let _ = writeln!(file, "[{stamp}] {message}");
    }
}

/// Send one payload to the notification window.
///
/// `queue_when_early` decides what happens before the webview has attached its
/// listener: lifecycle cards are held and flushed by [`notify_ready`], while
/// progress ticks are dropped. Queueing a tick would replay a stale percentage
/// seconds after the fact, and there is always another tick coming.
fn push<R: Runtime>(app: &AppHandle<R>, payload: NotifyPayload, queue_when_early: bool) {
    // `inner()` rather than using the `State` guard directly: a lock taken
    // through the guard borrows the local, which cannot outlive this function.
    let state = app.state::<NotifyState>();
    let state: &NotifyState = state.inner();

    if state.ready.load(Ordering::SeqCst) {
        if let Err(e) = app.emit_to(LABEL, "notify-push", payload) {
            log_notify(app, &format!("emit failed: {e}"));
        }
        return;
    }

    if queue_when_early {
        if let Ok(mut queue) = state.queue.lock() {
            queue.push(payload);
        }
    }
}

/// Raise or replace a card. Safe to call from any thread; never fails the caller.
pub fn notify<R: Runtime>(app: &AppHandle<R>, payload: NotifyPayload) {
    if let Err(e) = ensure_window(app) {
        log_notify(app, &format!("could not create the notification window: {e}"));
        return;
    }

    push(app, payload, true);
}

/// Update a card that is already on screen with a progress tick.
///
/// Does not create the window: a tick is only meaningful beside the card it
/// belongs to, and that card was raised through [`notify`].
pub fn notify_progress<R: Runtime>(app: &AppHandle<R>, payload: NotifyPayload) {
    push(app, payload, false);
}

/// Called by the notification webview once its listener is attached.
#[tauri::command]
pub fn notify_ready<R: Runtime>(app: AppHandle<R>) {
    let state = app.state::<NotifyState>();
    let state: &NotifyState = state.inner();
    state.ready.store(true, Ordering::SeqCst);

    let pending: Vec<NotifyPayload> = match state.queue.lock() {
        Ok(mut queue) => queue.drain(..).collect(),
        Err(_) => return,
    };

    for payload in pending {
        if let Err(e) = app.emit_to(LABEL, "notify-push", payload) {
            log_notify(&app, &format!("flush failed: {e}"));
        }
    }
}

/// Resize the window to exactly fit the rendered cards, then re-pin it.
///
/// Exact fit is not cosmetic. The window is transparent but still captures the
/// mouse across its whole rectangle, so any slack would be an invisible dead
/// zone swallowing clicks meant for whatever is underneath. `height <= 0` means
/// the stack is empty, and the window hides rather than lingering as a 380px
/// hole in the corner of the screen.
#[tauri::command]
pub fn notify_resize<R: Runtime>(app: AppHandle<R>, height: f64) -> Result<(), String> {
    let Some(win) = app.get_webview_window(LABEL) else {
        return Ok(());
    };

    if height < 1.0 {
        let _ = win.hide();
        return Ok(());
    }

    win.set_size(LogicalSize::new(WIDTH, height))
        .map_err(|e| e.to_string())?;
    reposition(&win).map_err(|e| e.to_string())?;

    if !win.is_visible().unwrap_or(false) {
        win.show().map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Reveal a finished download in Explorer, from a click on its card.
#[tauri::command]
pub async fn notify_open_location(path: String) -> Result<(), String> {
    crate::commands::open_file_location(path).await
}
