// Prevents additional console window on Windows in release mode
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Spawn the sidecar bridge: `granbridge serve` (no --open; Tauri shows the window)
            let sidecar = app.shell().sidecar("granbridge")?.args(["serve"]);
            let (mut rx, _child) = sidecar.spawn()?;
            tauri::async_runtime::spawn(async move {
                while let Some(ev) = rx.recv().await {
                    if let CommandEvent::Stderr(line) | CommandEvent::Stdout(line) = ev {
                        // Bridge logs — could forward to a window event in the future
                        let _ = line;
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
