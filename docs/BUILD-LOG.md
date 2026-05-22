# GRANBRIDGE Autonomous Build Log

User pre-approved all decisions and asked for autonomous progress through every sub-project
overnight (2026-05-21). Everything stays local (no remote push / external accounts / deploys).
Toolchains present: Python 3.14, Node 24 + npm. Absent: Rust/Cargo (Tauri native wrapper can't
compile here), MQTT broker. External-dependent features are built to the seam + stubbed + flagged.

## Status

| # | Sub-project | State |
|---|-------------|-------|
| 1 | The Bridge (BLE → JSON → WS → overlay) | ✅ complete, merged to master, 44 tests |
| 2 | Game Engine (X01/Cricket/practice, undo, bidir WS) | ✅ complete, 95 tests, reviewed (M1/M2/L1 fixed) |
| 3 | Desktop UI (React+TS+Tailwind+Zustand web app; Tauri config scaffolded) | ✅ complete, 36 UI tests, `npm run build` green |
| 4 | Integrations (plugin API + MQTT + example plugins) | ✅ complete, 111 tests, isolation-tested |
| 5 | OBS streaming overlay suite | ✅ complete, 118 tests, 5 overlays + launcher |
| F | Future: multiplayer relay, AI-commentary, CV-camera seam | ✅ complete, 129 tests (relay+commentary built, CV architecture-only) |

## Notes for the user (waking up)
- Anything needing YOU is collected in `docs/FOLLOWUPS.md` and flagged inline below as I go.
- Each sub-project follows brainstorm→spec→plan→build; specs in `docs/superpowers/specs/`,
  plans in `docs/superpowers/plans/`.

## Log
- SP1: complete (see git history a4348de…e3100e4).
- SP2: spec 00416ff; plan 31707e7; built subagent-driven (foundation seq, 4 modes parallel, engine, wiring); opus review found M1/M2/L1 → fixed; 95 tests; merging to master.
- SP3: built subagent-driven (scaffold+foundation seq; 4 boards + components parallel; shell seq). 36 UI tests, web build green. Tauri scaffold under ui/src-tauri/ (needs Rust to compile). Merged to master.
- SP4: built subagent-driven (base+config seq; manager+4 plugins parallel; registry+cli+docs seq). 111 tests. Plugins consume-only + exception-isolated; aiomqtt/httpx lazy + fakes in tests; broker/webhook/WLED-host flagged. Merged to master.
- SP5: built (one subagent: common.js + 5 overlays + launcher + asset tests). 118 tests. Merged to master.
- F: built parallel (relay, commentary, vision seam) + serial integration. 129 tests. `granbridge relay` runs a local room relay; commentary plugin emits `commentary` events (template now, LLM seam flagged); camera CV is architecture-only (docs/camera-validation-architecture.md). Merged to master.

## ALL SUB-PROJECTS COMPLETE (2026-05-21 overnight run)
Master green: 129 Python tests + 36 UI tests. See the wake-up summary below.

---

## Wake-up summary

Overnight I took GRANBRIDGE from "Milestone 1 just merged" through **all six sub-projects**, each
via the full brainstorm→spec→plan→build→review→merge cycle (I self-approved gates per your
pre-approval) on its own branch, fast-forward-merged to `master`. Specs in
`docs/superpowers/specs/`, plans in `docs/superpowers/plans/`.

**Built & merged (all on `master`):**
1. **The Bridge** — BLE → decode → JSON → WebSocket → overlay (44 tests).
2. **Game Engine** — X01 / Cricket / Around-the-Clock / Free-play, 3-dart visits, auto+manual
   advance, snapshot undo + correct-misread, bust-revert, best-of-legs, X01 checkout suggestions;
   the WebSocket is now bidirectional (start_game/next/undo/correct/end commands). Reviewed; 2 real
   bugs fixed.
3. **Desktop UI** — React+TS+Vite+Tailwind+Zustand web app in `ui/`: setup screen, per-mode live
   boards, controls, banners, kiosk mode; `npm run build` green; Tauri scaffold present.
4. **Integrations** — plugin API + manager (error-isolated) + MQTT / Discord / WLED / logging
   plugins, config-driven.
5. **OBS overlay suite** — scoreboard / checkout / throw / stats / lower-third + launcher, sharing
   one WS helper; all safe-DOM.
6. **Future foundations** — local multiplayer relay (`granbridge relay`) + relay plugin; AI
   commentary (offline template commentator + `commentary` events + LLM seam); camera CV validation
   **architecture + interface seam only**.

**Totals:** 165 tests (129 Python + 36 UI), all green and hardware-free. Clean commit history,
one squash-commit per sub-project (+ doc/review commits).

**What still needs YOU (flagged, by design — I kept everything local):**
- **Run against your board:** `granbridge scan` → `calibrate` → `serve` (only bull/dbull/miss are
  pre-seeded; calibrate maps the rest live). This is the one thing I couldn't do (no hardware here).
- **Rust toolchain** to compile the native Tauri desktop app (`cargo tauri build`); the web UI works now.
- **Endpoints/keys** to activate integrations: an MQTT broker, a Discord webhook URL, a WLED host;
  an LLM API key + a TTS voice for richer commentary; relay hosting+auth+TLS to go beyond LAN.
- **Cameras + OpenCV** if you ever want CV autoscoring (deliberately architecture-only — you chose
  player-cams, which already ship in `overlay/broadcast.html`).

**Open follow-ups:** see `docs/FOLLOWUPS.md` (e.g. wire §8 headless log sinks, bound bus queues,
origin-guard before any non-loopback bind, AppData config path for packaging, X01 "sets").

**Suggested next session:** validate live on the board + calibrate; then either install Rust to
ship the portable Tauri app, or harden the follow-ups for a public/streamed setup.

---

## Productionization (2026-05-22)

- **GitHub:** pushed to https://github.com/burgerearmuffs/granbridge (public, `main`, force-replaced the boilerplate init). `gh` CLI installed + authed.
- **Step 2a — self-serving exe (DONE):** the bridge now serves the built UI at `/` and overlays at
  `/overlays/` over HTTP (default :8080, path-traversal-hardened) alongside the WS (:8787).
  `serve --open` opens the browser; the frozen entry runs `serve --open` on no-args.
  PyInstaller onedir build → `dist/granbridge/granbridge.exe` (gitignored). Smoke-tested:
  `--help` ✓, `scan` ✓ (Bleak/WinRT bundle cleanly, 1 build iteration). 132 tests.
  **To test now:** double-click `dist\granbridge\granbridge.exe` (with the board awake) — it serves
  the UI, opens the browser, and connects over BLE. Or `granbridge.exe scan` / `... calibrate` first.
- **Step 2b — native Tauri app (PENDING your toolchain):** waiting on Rust (rustup) + MSVC C++ Build
  Tools install. Once ready, the Tauri app bundles this same exe as a sidecar → a true windowed
  portable app + `.msi`. Then Step 1 (hardware test), Step 3 (depth/polish), Step 4 (future).
