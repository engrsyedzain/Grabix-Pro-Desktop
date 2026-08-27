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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyPayload {
    /// The download id. Reused across started -> finished so the frontend can
    /// replace the card in place instead of stacking two for one download.
    pub id: String,
    /// "started" | "finished" | "error"
    pub kind: String,
    pub title: String,
    /// Set on "finished": the file to reveal when the card is clicked.
    pub path: Option<String>,
}

/// A progress tick for a card that is already on screen.
///
/// Deliberately a separate, smaller event from [`NotifyPayload`]: these arrive
/// once per whole percent for the length of a download, and re-sending the title
/// and kind with each one would be pure waste.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyProgress {
    /// The download id, matching the card raised by [`notify`].
    pub id: String,
    /// 0-100, or `None` when yt-dlp reports an unknown percentage.
    pub progress: Option<f64>,
    /// yt-dlp's own speed string, e.g. "3.21MiB/s".
    pub speed: Option<String>,
    /// yt-dlp's own ETA string, e.g. "00:42".
    pub eta: Option<String>,
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

/// Raise a notification. Safe to call from any thread; never fails the caller.
pub fn notify<R: Runtime>(app: &AppHandle<R>, payload: NotifyPayload) {
    if let Err(e) = ensure_window(app) {
        eprintln!("notify: could not create the notification window: {e}");
        return;
    }

    // `inner()` rather than using the `State` guard directly: a lock taken
    // through the guard borrows the local, which cannot outlive this function.
    let state = app.state::<NotifyState>();
    let state: &NotifyState = state.inner();

    if state.ready.load(Ordering::SeqCst) {
        let _ = app.emit_to(LABEL, "notify-push", payload);
        return;
    }

    if let Ok(mut queue) = state.queue.lock() {
        queue.push(payload);
    }
}

/// Push a progress tick to a card that is already on screen.
///
/// Unlike [`notify`], this never queues and never creates the window. A tick is
/// only meaningful next to the card it belongs to, and that card was raised
/// through `notify` - so if the webview is not listening yet, the right thing to
/// do with a tick is drop it and send the next one.
pub fn notify_progress<R: Runtime>(app: &AppHandle<R>, payload: NotifyProgress) {
    let state = app.state::<NotifyState>();
    let state: &NotifyState = state.inner();

    if state.ready.load(Ordering::SeqCst) {
        let _ = app.emit_to(LABEL, "notify-progress", payload);
    }
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
        let _ = app.emit_to(LABEL, "notify-push", payload);
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
