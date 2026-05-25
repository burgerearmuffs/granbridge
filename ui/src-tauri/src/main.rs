// Prevents additional console window on Windows in release mode
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the bridge sidecar handle so we can terminate it when the app exits.
struct Sidecar(Mutex<Option<CommandChild>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Spawn the sidecar bridge: `granbridge serve` (no --open; Tauri shows the window)
            let sidecar = app.shell().sidecar("granbridge")?.args(["serve"]);
            let (mut rx, child) = sidecar.spawn()?;
            // Retain the child so it can be killed on exit — otherwise the bridge
            // (which serves WS/HTTP and holds the BLE connection) outlives the UI.
            app.manage(Sidecar(Mutex::new(Some(child))));
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(sidecar) = app.try_state::<Sidecar>() {
                    if let Some(child) = sidecar.0.lock().unwrap().take() {
                        kill_sidecar(child);
                    }
                }
            }
        });
}

/// Terminate the sidecar bridge and any processes it spawned.
///
/// The sidecar is a PyInstaller one-file exe whose bootloader can spawn a child,
/// and Windows does not cascade `TerminateProcess` to children — so kill the whole
/// process tree by PID (`taskkill /T`) rather than only the tracked process.
fn kill_sidecar(child: CommandChild) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let pid = child.pid();
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
}
