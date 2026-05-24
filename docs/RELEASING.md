# Releasing GRANBRIDGE

The repeatable steps to cut a Windows release. **Policy: every release ships `QUICKSTART.md` as an
asset** (alongside the installers + portable zip). This runbook reflects the exact process used for
v0.1.1.

## Artifacts every release includes
1. `GRANBRIDGE_<ver>_x64_en-US.msi` — MSI installer
2. `GRANBRIDGE_<ver>_x64-setup.exe` — NSIS setup
3. `granbridge-<ver>-portable-win64.zip` — no-install portable build
4. **`QUICKSTART.md`** — the quick-start guide (required, every release)
5. **`GRANBRIDGE_<ver>_x64-setup.exe.sig`** — minisign signature of the NSIS setup (auto-updater)
6. **`latest.json`** — auto-updater manifest (auto-updater). The installed app fetches this from
   `releases/latest/download/latest.json`, so it MUST be attached to every release that should be
   offered as an update. Only NSIS-installed users auto-update; portable-zip users update manually.

## Prerequisites / environment gotchas
- Python venv at `.venv` with PyInstaller. Build-time `Pillow` only needed if regenerating the icon.
- **Rust/cargo** and the **GitHub CLI** are installed but may not be on a given shell's PATH:
  - cargo: `export PATH="$HOME/.cargo/bin:$PATH"` (it's `~/.cargo/bin/cargo.exe`).
  - gh: `"C:\Program Files\GitHub CLI\gh.exe"` (authed as the repo owner).
- Heavy native builds (PyInstaller, cargo/MSVC) may need the shell sandbox disabled.
- **Updater signing** (one time): generate a minisign keypair —
  `npm --prefix ui run tauri -- signer generate -w "$HOME/.granbridge-updater.key"`.
  The **public** key lives in `ui/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`); keep the
  **private** key file and its password **off-repo** (never commit — `.gitignore` blocks `*.key`).
  The auto-updater refuses any release whose `.sig` doesn't verify against the public key.

## Steps

1. **Bump the version** in `ui/src-tauri/tauri.conf.json` (`"version"`) and `pyproject.toml`
   (`version`). The installer filenames come from `tauri.conf.json`.

2. **(If the icon changed)** regenerate it:
   ```
   .venv/Scripts/python.exe tools/make_icon.py
   npm --prefix ui run tauri -- icon C:/Users/willa/granbridge/tools/granbridge-icon.png
   # drop the unused mobile dirs for the Windows-only target:
   rm -rf ui/src-tauri/icons/android ui/src-tauri/icons/ios
   ```

3. **Build the UI + PyInstaller artifacts** (the specs bundle `ui/dist`, so build the UI first):
   ```
   npm --prefix ui run build
   .venv/Scripts/python.exe -m PyInstaller packaging/granbridge.spec --noconfirm --distpath dist --workpath build/pyi
   .venv/Scripts/python.exe -m PyInstaller packaging/granbridge-sidecar.spec --noconfirm --distpath dist/sidecar --workpath build/pyi-sidecar
   cp dist/sidecar/granbridge.exe ui/src-tauri/binaries/granbridge-x86_64-pc-windows-msvc.exe
   ```

4. **Build the installers** (cargo must be on PATH). Set the signing env vars so `tauri build` signs
   the NSIS artifact and emits `latest.json` (because `bundle.createUpdaterArtifacts` is on):
   ```
   export PATH="$HOME/.cargo/bin:$PATH"
   export TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.granbridge-updater.key")"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<your key password>"
   npm --prefix ui run tauri -- build
   # → ui/src-tauri/target/release/bundle/{msi,nsis}/GRANBRIDGE_<ver>_*
   #   plus GRANBRIDGE_<ver>_x64-setup.exe.sig and a generated latest.json (under bundle/)
   ```
   If the env vars are unset, the build still produces installers but WITHOUT a signature/`latest.json`,
   and the auto-updater will reject them — so they are required for any release meant to be auto-updated.

5. **Make the portable zip** from the onedir build:
   ```
   Compress-Archive -Path dist\granbridge -DestinationPath dist\granbridge-<ver>-portable-win64.zip -CompressionLevel Optimal
   ```

6. **Update `QUICKSTART.md`** if anything user-facing changed. Its download links point at
   `releases/latest`, so they don't need per-release edits — but review the "Play"/"Troubleshooting"
   sections for new features/modes.

7. **Write release notes** (a temp `.md`) summarizing what's new.

8. **Commit + push** the version bump (and any icon/doc changes) to `main`.

9. **Cut the release** with all four assets (the three build artifacts **and** `QUICKSTART.md`):
   ```
   "C:\Program Files\GitHub CLI\gh.exe" release create v<ver> --target main --prerelease \
     --title "GRANBRIDGE v<ver>" --notes-file <notes.md> \
     "ui\src-tauri\target\release\bundle\msi\GRANBRIDGE_<ver>_x64_en-US.msi" \
     "ui\src-tauri\target\release\bundle\nsis\GRANBRIDGE_<ver>_x64-setup.exe" \
     "ui\src-tauri\target\release\bundle\nsis\GRANBRIDGE_<ver>_x64-setup.exe.sig" \
     "dist\granbridge-<ver>-portable-win64.zip" \
     "QUICKSTART.md" \
     "<path-to-generated>\latest.json"
   ```
   The `.sig` and `latest.json` are emitted by step 4 (look under `ui/src-tauri/target/release/bundle/`).
   `latest.json` carries the new version, the NSIS download URL, and the signature the updater verifies.
   **Both must be attached** or installed clients won't see/accept the update.
   Drop `--prerelease` once the project hits a stable milestone.

10. **Verify**: `gh release view v<ver> --json tagName,assets` shows the tag + all four assets.
