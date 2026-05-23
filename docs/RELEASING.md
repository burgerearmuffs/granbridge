# Releasing GRANBRIDGE

The repeatable steps to cut a Windows release. **Policy: every release ships `QUICKSTART.md` as an
asset** (alongside the installers + portable zip). This runbook reflects the exact process used for
v0.1.1.

## Artifacts every release includes
1. `GRANBRIDGE_<ver>_x64_en-US.msi` — MSI installer
2. `GRANBRIDGE_<ver>_x64-setup.exe` — NSIS setup
3. `granbridge-<ver>-portable-win64.zip` — no-install portable build
4. **`QUICKSTART.md`** — the quick-start guide (required, every release)

## Prerequisites / environment gotchas
- Python venv at `.venv` with PyInstaller. Build-time `Pillow` only needed if regenerating the icon.
- **Rust/cargo** and the **GitHub CLI** are installed but may not be on a given shell's PATH:
  - cargo: `export PATH="$HOME/.cargo/bin:$PATH"` (it's `~/.cargo/bin/cargo.exe`).
  - gh: `"C:\Program Files\GitHub CLI\gh.exe"` (authed as the repo owner).
- Heavy native builds (PyInstaller, cargo/MSVC) may need the shell sandbox disabled.

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

4. **Build the installers** (cargo must be on PATH):
   ```
   export PATH="$HOME/.cargo/bin:$PATH"
   npm --prefix ui run tauri -- build
   # → ui/src-tauri/target/release/bundle/{msi,nsis}/GRANBRIDGE_<ver>_*
   ```

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
     "dist\granbridge-<ver>-portable-win64.zip" \
     "QUICKSTART.md"
   ```
   Drop `--prerelease` once the project hits a stable milestone.

10. **Verify**: `gh release view v<ver> --json tagName,assets` shows the tag + all four assets.
