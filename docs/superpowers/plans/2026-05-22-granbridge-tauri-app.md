# GRANBRIDGE Native Tauri App (Step 2b) — Design + Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Subagent does NOT commit. Tauri v2 + first Rust compile is slow and iterative — build, read errors, fix config, rebuild. Consult current Tauri v2 docs if an API mismatch appears. Rust is at `~/.cargo/bin` (export PATH).

**Goal:** A native Windows desktop app that launches the GRANBRIDGE bridge automatically and shows the UI in a window, packaged as an installer. The bridge is bundled as a PyInstaller **onefile** sidecar that Tauri spawns on startup.

**Design:**
- `granbridge.exe` (onefile, from `packaging/granbridge-sidecar.spec`) → copied to `ui/src-tauri/binaries/granbridge-x86_64-pc-windows-msvc.exe` (Tauri sidecar naming).
- Tauri v2: `frontendDist=../dist` (the built UI), `bundle.externalBin=["binaries/granbridge"]`, `tauri-plugin-shell` to spawn the sidecar. On `setup`, spawn `granbridge serve` (no `--open`; Tauri shows the window). UI connects to `ws://127.0.0.1:8787`.
- `npx tauri build` → installer under `ui/src-tauri/target/release/bundle/`.

**Toolchain:** Rust 1.95 (msvc), Node 24, PyInstaller 6.20, WebView2 (Win11).

---

## Task 1: Onefile sidecar exe

**Files:** `packaging/granbridge-sidecar.spec`.

- [ ] Copy `packaging/granbridge.spec` to `packaging/granbridge-sidecar.spec` but make it **onefile** (single EXE with binaries/datas embedded): replace the `EXE(... exclude_binaries=True)` + `COLLECT(...)` with a single `EXE(pyz, a.scripts, a.binaries, a.datas, [], name="granbridge", console=True, onefile=True)` (PyInstaller onefile form — `exclude_binaries=False`, no COLLECT). Keep the same `datas` (ui_dist, overlay) and `collect_all` hidden imports.
- [ ] Build: `.venv\Scripts\python -m PyInstaller packaging/granbridge-sidecar.spec --noconfirm --distpath dist/sidecar --workpath build/pyi-sidecar` → `dist/sidecar/granbridge.exe`.
- [ ] Smoke: `dist\sidecar\granbridge.exe --help` and `... scan` run without ImportError. (Onefile unpacks to temp; first run is slower.) If WinRT fails at runtime under onefile, add the failing submodule to `hiddenimports` and rebuild; if it still fails, FALL BACK to bundling the onedir build as Tauri `resources` instead of a sidecar (spawn the resolved resource path from Rust) and note it.
- [ ] Copy the exe to the sidecar location with the target-triple name:
  `mkdir -p ui/src-tauri/binaries && cp dist/sidecar/granbridge.exe "ui/src-tauri/binaries/granbridge-x86_64-pc-windows-msvc.exe"`

---

## Task 2: Tauri v2 config + sidecar spawn

**Files:** update `ui/src-tauri/tauri.conf.json`, `ui/src-tauri/Cargo.toml`, `ui/src-tauri/src/main.rs`; create `ui/src-tauri/capabilities/default.json`; add `@tauri-apps/cli` to `ui/package.json` devDeps; read the existing SP3 scaffold first.

- [ ] **package.json (ui):** add devDep `"@tauri-apps/cli": "^2"` and scripts `"tauri": "tauri"`. Run `npm install`.
- [ ] **tauri.conf.json (v2 schema):**
  - `build.frontendDist = "../dist"`, `build.devUrl = "http://localhost:5173"`, `build.beforeBuildCommand = "npm run build"`.
  - `app.windows = [{ "title": "GRANBRIDGE", "width": 1280, "height": 800, "resizable": true }]`.
  - `bundle.active = true`, `bundle.targets = ["msi","nsis"]`, `bundle.externalBin = ["binaries/granbridge"]`, `identifier = "com.granbridge.app"`.
- [ ] **Cargo.toml:** Tauri v2 deps — `tauri = { version = "2", features = [] }`, `tauri-plugin-shell = "2"`, `serde`/`serde_json`; `tauri-build = { version = "2" }` in build-deps.
- [ ] **capabilities/default.json:** grant the main window `shell:allow-execute` and the sidecar permission for `granbridge`:
```json
{ "$schema": "../gen/schemas/desktop-schema.json", "identifier": "default", "windows": ["main"],
  "permissions": ["core:default", "shell:allow-execute",
    { "identifier": "shell:allow-spawn", "allow": [{ "name": "binaries/granbridge", "sidecar": true }] }] }
```
  (Adjust permission identifiers to the installed tauri-plugin-shell version's schema if the build complains.)
- [ ] **src/main.rs:** register the shell plugin and spawn the sidecar on setup:
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let sidecar = app.shell().sidecar("granbridge")?.args(["serve"]);
            let (mut rx, _child) = sidecar.spawn()?;
            tauri::async_runtime::spawn(async move {
                while let Some(ev) = rx.recv().await {
                    if let CommandEvent::Stderr(line) | CommandEvent::Stdout(line) = ev {
                        let _ = line; // bridge logs; could forward to a window event later
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
  (If the SP3 scaffold used `lib.rs`/`run()`, adapt to that structure.)

---

## Task 3: Build the installer

- [ ] From `ui/`: `npx tauri build` (export PATH to include `~/.cargo/bin`). First build compiles many crates — allow several minutes; fetch from crates.io is required.
- [ ] Iterate on any Rust/Tauri config errors (schema fields, plugin permission identifiers, sidecar naming) until the build succeeds.
- [ ] Confirm the installer(s) exist under `ui/src-tauri/target/release/bundle/` (msi/ and/or nsis/). Report the exact path(s) + file sizes.
- [ ] Note: the windowed app launching + actually spawning the bridge + BLE is verified by the USER double-clicking the built app/installer (can't be confirmed headlessly here). Success criterion for this task = a built installer + correct sidecar/spawn config.

---

## Task 4: gitignore + docs

- [ ] `.gitignore`: add `ui/src-tauri/target/`, `ui/src-tauri/binaries/`, `dist/sidecar/`, `build/pyi-sidecar/` (build artifacts + the bundled exe are not committed).
- [ ] README "Native app (Tauri)" section: prerequisites (Rust msvc, WebView2); build = `cd ui && npm install && npx tauri build`; output installer path; how to rebuild the sidecar exe (`PyInstaller packaging/granbridge-sidecar.spec` → copy to `src-tauri/binaries/`). Note the app auto-starts the bridge; do `calibrate` once via the CLI exe for your board.

---

## Self-Review
- **Coverage:** onefile sidecar (T1), Tauri v2 wiring + spawn (T2), installer build (T3), gitignore/docs (T4).
- **Risks/iteration:** PyInstaller onefile+WinRT (fallback: onedir-as-resources); Tauri v2 permission-schema identifiers may differ by plugin version (consult docs, iterate); long first compile.
- **Safety:** sidecar runs locally; no new network surface beyond the bridge's existing localhost WS/HTTP.
