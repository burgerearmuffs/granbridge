# Client Auto-Updater (Design)

- **Date:** 2026-05-24 · Self-approved (autonomous mandate). User actively picked the two design forks below.
- **Goal:** The GRANBRIDGE desktop client checks GitHub on launch for a newer release and offers a
  one-click "download + install + relaunch". Built on the official **Tauri v2 updater** so we inherit
  signature verification rather than hand-rolling an unsafe downloader.
- **Branch:** `client-auto-updater`.

## User decisions (2026-05-24)
1. **Update target = NSIS installer only.** Auto-update covers users who installed via the `.exe`/`.msi`.
   Portable-zip users can't be updated in place (Windows can't overwrite a running `.exe`), so they only
   get a *notice* with a download link — no self-install.
2. **UX = notify, then one-click.** Silent check on launch; if a newer version exists, show a dismissible
   banner ("vX.Y.Z available — Update & restart"). One click → download with progress → relaunch. Network
   errors fail silently so launch is never blocked.

## Why
The official app auto-updates; GRANBRIDGE currently requires a manual re-download. Tauri v2 ships
`tauri-plugin-updater`, which does exactly check→download→verify→install→relaunch and **mandates a
minisign signature** on every update (a tampered GitHub release cannot push an unsigned/forged binary).
Pointing the updater's `endpoints` at `releases/latest/download/latest.json` makes GitHub itself the
"is there a newer version?" oracle — no server, no extra infrastructure.

## How it works (runtime flow)
1. App launches; frontend `useUpdater` hook calls `check()` from `@tauri-apps/plugin-updater` once on mount.
2. The plugin GETs `latest.json`, substituting `{{target}}`/`{{arch}}`/`{{current_version}}`. If
   `latest.json.version` > `tauri.conf.json` version → an `Update` handle is returned, else `null`.
3. Available → `UpdateBanner` shows version + notes + "Update & restart".
4. Click → `update.downloadAndInstall(onEvent)` streams the signed NSIS setup, verifies the minisign
   signature against the embedded `pubkey`, runs the installer in `passive` mode, then we call
   `relaunch()` from `@tauri-apps/plugin-process`.
5. Any check/download error is caught and logged only; the banner just doesn't appear (or shows a
   non-fatal "update failed, try later"). Launch and gameplay are never blocked.

## Components

### Rust (`ui/src-tauri`)
- `Cargo.toml`: add `tauri-plugin-updater = "2"` and `tauri-plugin-process = "2"`.
- `src/main.rs`: register `.plugin(tauri_plugin_updater::Builder::new().build())` and
  `.plugin(tauri_plugin_process::init())` (added before the existing shell plugin / setup).
- `capabilities/default.json`: add permissions `updater:default` and `process:allow-restart`.

### Config (`ui/src-tauri/tauri.conf.json`)
- `plugins.updater`:
  - `"pubkey"`: the minisign **public** key (filled in after `tauri signer generate`).
  - `"endpoints"`: `["https://github.com/burgerearmuffs/granbridge/releases/latest/download/latest.json"]`.
  - `"windows": { "installMode": "passive" }` — NSIS runs with a small progress UI, no wizard clicks.
- `bundle.createUpdaterArtifacts: true` — makes `tauri build` emit the `.sig` and a `latest.json`
  next to the NSIS setup.

### Frontend (`ui/src`)
- `useUpdater.ts` — hook returning `{ phase, version, notes, progress, error, startUpdate, dismiss }`,
  where `phase ∈ "idle" | "checking" | "available" | "downloading" | "ready" | "error" | "dismissed"`.
  Checks once on mount; guards against double-checks (React StrictMode mounts effects twice in dev).
  Detects non-Tauri/browser context and no-ops (so `npm run dev` in a plain browser doesn't throw).
- `components/UpdateBanner.tsx` — presentational banner driven by the hook state; shows version + a
  short notes line, an "Update & restart" button (→ `startUpdate`), a download progress %, and a
  dismiss "×". Hidden when `phase` is `idle`/`dismissed`.
- `App.tsx` — instantiate the hook near the top and render `<UpdateBanner …/>` just under the header
  (above `<Banners/>`), so it's visible in normal mode but suppressed in `kiosk` mode.

### Release pipeline (`docs/RELEASING.md`)
- New prerequisite: minisign keypair via `npm --prefix ui run tauri -- signer generate -w ~/.granbridge-updater.key`
  (one time). Public key → `tauri.conf.json`; private key file + its password kept **off-repo** by the user.
- Build step exports `TAURI_SIGNING_PRIVATE_KEY` (path or contents) and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` before `tauri build`, which then signs the NSIS artifact and
  writes `latest.json`.
- Release-upload step adds two assets alongside the existing four: the generated
  `latest.json` and the `GRANBRIDGE_<ver>_x64-setup.exe.sig`. (The updater downloads the setup `.exe`
  from the release; `latest.json` carries its URL + signature.)

## Testing
- **Vitest unit tests** (mock `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process`):
  1. `check()` returns an update → hook reaches `phase: "available"` with the right version/notes.
  2. `check()` returns `null` → stays `idle`, banner not rendered.
  3. `startUpdate()` calls `downloadAndInstall` then `relaunch`; progress events advance `progress`.
  4. `check()` rejects → `phase: "error"`, no throw, launch unaffected.
  5. Non-Tauri context → hook no-ops, banner never shows.
  6. `UpdateBanner` render tests: button wiring, dismiss hides it, progress display.
- **Rust** is config/registration only — covered by `tauri build` succeeding (the existing release build).
- Existing frontend test suite stays green.

## Out of scope
- Portable-zip self-update (decided: notice-only).
- Background/automatic install without a click (decided against: notify-then-one-click).
- A staged-rollout / update server, channels (beta/stable), or delta updates — `latest.json` on
  GitHub is sufficient for now.
- Code-signing the installer with an Authenticode cert (separate from the updater's minisign signing;
  not required for the updater to function).

## Success criteria
1. Launching an installed build that is older than `releases/latest` shows the update banner; one click
   downloads, verifies, installs, and relaunches into the new version.
2. Up-to-date build shows no banner; offline/launch with no network shows no banner and no error dialog.
3. `tauri build` with the signing env vars emits a signed NSIS setup + `.sig` + `latest.json`.
4. `docs/RELEASING.md` documents keypair generation, the signing env vars, and the two new assets.
5. Vitest covers available/none/click/error/non-Tauri paths; existing suites stay green.
