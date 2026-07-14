// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The main binary now ONLY launches the Tauri GUI application.
    // Native Messaging is handled by the dedicated `grabix-native-host` binary,
    // which avoids the windows_subsystem="windows" conflict with stdin/stdout.
    //
    // When the browser extension sends a message, it goes to grabix-native-host,
    // which then launches this binary with the URL as an argument.
    // The single-instance plugin in lib.rs intercepts repeat launches and
    // forwards the URL to the already-running window via the "download-url" event.
    grabix_pro_lib::run()
}
