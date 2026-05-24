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
   the artifacts (because `bundle.createUpdaterArtifacts` is on):
   ```
   export PATH="$HOME/.cargo/bin:$PATH"
   export TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.granbridge-updater.key")"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<your key password>"
   npm --prefix ui run tauri -- build
   # → ui/src-tauri/target/release/bundle/{msi,nsis}/GRANBRIDGE_<ver>_*
   #   plus GRANBRIDGE_<ver>_x64-setup.exe.sig  (and the .msi.sig)
   ```
   `createUpdaterArtifacts` emits the **`.sig` signature files only** — it does NOT generate
   `latest.json`. If the env vars are unset, no `.sig` is produced and the auto-updater will reject
   the release, so they are required for any release meant to be auto-updated.

4b. **Generate `latest.json` by hand** from the NSIS `.sig` (the updater downloads the NSIS setup):
   ```
   node -e '
   const fs=require("fs");
   const sig=fs.readFileSync("ui/src-tauri/target/release/bundle/nsis/GRANBRIDGE_<ver>_x64-setup.exe.sig","utf8").trim();
   fs.writeFileSync("latest.json", JSON.stringify({
     version:"<ver>",
     notes:"<one-line summary>",
     pub_date:new Date().toISOString(),
     platforms:{"windows-x86_64":{ signature:sig,
       url:"https://github.com/burgerearmuffs/granbridge/releases/download/v<ver>/GRANBRIDGE_<ver>_x64-setup.exe" }}
   },null,2));'
   ```
   The `signature` is the full contents of the `.sig`; the `url` must match the NSIS asset name on the
   release exactly.

5. **Make the portable zip** from the onedir build:
   ```
   Compress-Archive -Path dist\granbridge -DestinationPath dist\granbridge-<ver>-portable-win64.zip -CompressionLevel Optimal
   ```

6. **Update `QUICKSTART.md`** if anything user-facing changed. Its download links point at
   `releases/latest`, so they don't need per-release edits — but review the "Play"/"Troubleshooting"
   sections for new features/modes.

7. **Write release notes** (a temp `.md`) summarizing what's new.

8. **Commit + push** the version bump (and any icon/doc changes) to `main`.

9. **Cut the release** with all six assets. **Do NOT use `--prerelease`** for any release that should
   be offered to the auto-updater: the updater endpoint is `releases/latest/download/latest.json`, and
   GitHub's `releases/latest` pointer **ignores prereleases** — a prerelease would 404 there and no
   client would ever see the update.
   ```
   "C:\Program Files\GitHub CLI\gh.exe" release create v<ver> --target main \
     --title "GRANBRIDGE v<ver>" --notes-file <notes.md> \
     "ui\src-tauri\target\release\bundle\msi\GRANBRIDGE_<ver>_x64_en-US.msi" \
     "ui\src-tauri\target\release\bundle\nsis\GRANBRIDGE_<ver>_x64-setup.exe" \
     "ui\src-tauri\target\release\bundle\nsis\GRANBRIDGE_<ver>_x64-setup.exe.sig" \
     "dist\granbridge-<ver>-portable-win64.zip" \
     "QUICKSTART.md" \
     "latest.json"
   ```
   `latest.json` (step 4b) + the `.sig` (step 4) **must both be attached** or installed clients won't
   see/accept the update.

10. **Verify the update chain**: confirm `curl -sL releases/latest/download/latest.json` returns the new
    version and that its `platforms.windows-x86_64.url` returns HTTP 200.

11. **Verify assets**: `gh release view v<ver> --json tagName,isPrerelease,assets` shows the tag,
    `isPrerelease=false`, and all six assets.
