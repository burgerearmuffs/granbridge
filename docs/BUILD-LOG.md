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
- **Step 2b — native Tauri app (DONE):** Rust 1.95 (msvc) + MSVC Build Tools verified. Built a
  PyInstaller **onefile** sidecar (`packaging/granbridge-sidecar.spec`, 21.7 MB), registered it as a
  Tauri v2 `externalBin`, and the Rust `setup()` spawns `granbridge serve` via tauri-plugin-shell so
  launching the app boots the bridge + shows the UI in a native window. `npx tauri build` →
  **installers**: `ui/src-tauri/target/release/bundle/msi/GRANBRIDGE_0.1.0_x64_en-US.msi` (25 MB) and
  `.../nsis/GRANBRIDGE_0.1.0_x64-setup.exe` (24 MB). 132 tests still green. Placeholder icons (cosmetic
  follow-up). **STEP 2 COMPLETE.**

**Next:** Step 1 (validate on the board — install the .msi or run the exe, calibrate), then Step 3
(depth/polish: stats/history, real icons, FOLLOWUPS hardening), then Step 4 (future features).

---

## Step 3 — Depth & Polish (2026-05-22, autonomous run 2, while user tests on hardware)

Roadmap in `docs/superpowers/specs/2026-05-22-step3-polish-roadmap.md`. Run guardrails honored:
**no BLE/protocol/decoder/segment-map edits** (user was live-calibrating) and **no exe/installer
rebuild**. Each sub-project: branch → build (subagent-driven) → test → merge to `main` → push to GitHub.

- **SP-A · Rich graphics (named priority) ✅** — SVG `Dartboard` (classic colors, last-hit highlight),
  confetti `Celebration`, arcade theme + `score-pop`/`dartboard-hit`/`bust-shake` animations, store
  tracks `lastHit`. (`f6587f3`)
- **SP-B · Sound effects (named priority) ✅** — procedural Web Audio SFX (hit/treble/bull/bust/leg/
  game/**180**/checkout-chime); pure `SoundDecider` (tested) + `SynthPack` + `SoundManager`
  (mute/volume persisted); `manifest.ts` slots for real audio files. (`2f256ba`)
- **SP-C · Checkout videos (named priority) ✅** — `CheckoutOverlay` "GAME SHOT!" full-screen moment:
  plays `/videos/<event>.mp4` if present, else procedural celebration; reduced-motion + toggle;
  `public/{videos,sounds}/README.md` document drop-in asset slots. (`ca49831`)
- **SP-D · Stats & history ✅** — SQLite `HistoryStore` + always-on `HistoryPlugin` recorder; JSON API
  `/api/history/{recent,stats,heatmap}`; UI History view (3-dart avgs, wins, recent games) + dartboard
  **heatmap** + Live/History nav. DB under `%LOCALAPPDATA%\granbridge`. (`5b276d6`)
- **SP-E · Hardening ✅** — bounded bus queues (drop-oldest), always-on decoded-event log sink
  (`logs/decoded_packets/events.jsonl`, spec §8), X01 **sets** match structure (backward-compatible).
  (`da44a38`)

**Totals after run 2:** 160 Python + 127 UI tests, all green; UI builds clean. All on `main`, pushed.

**Asset reality (for the user):** graphics are vector/procedural (real, working now). Sound is
synthesized by default — working now — drop files in `ui/public/sounds/` to override. Checkout
**videos** ship with a procedural fallback; drop real clips in `ui/public/videos/` (filenames in the
READMEs) to use them. All three named priorities are functional today and upgradeable with real assets.

**Step 3 remaining (not done this run):** real app icons (needs image tooling + a Tauri rebuild —
deferred since I didn't rebuild the installer); WS origin-guard for non-loopback binds; raw-frame log
sink (BLE-adjacent, skipped to respect the calibration guardrail); `overrides_path`→AppData (skipped —
it's where live calibration writes). These are queued for a session when you're not mid-calibration.

**To see Step 3 in action:** `cd ui && npm install && npm run dev` → open the served UI (run
`granbridge.exe serve` for live data), or rebuild the packaged app (`PyInstaller` + `npx tauri build`)
to fold these features into a new installer.

---

## Internet multiplayer — the reframe (2026-05-22)

User reframed the project: **internet multiplayer is now the primary purpose** (premium remote dart
experience). Target features in `docs/TARGET-FEATURES.md`; competitive analysis of the official app in
`docs/RESEARCH-official-app.md` (key finding: in-match **video is parity, not polish**; their worst
weakness is **BLE reliability** = our differentiator). Architecture in
`docs/superpowers/specs/2026-05-22-multiplayer-architecture.md`. Self-hosted on the user's Proxmox box
"TOWER" (public IP); decisions locked: host-authoritative sync, anonymous IDs, WebRTC P2P A/V, separate
Dockerized broker + coturn.

- **MP-1 · Broker (Dockerized) ✅** — `server/` standalone WebSocket broker: rooms + password + presence +
  WebRTC signaling relay; Dockerfile + compose (broker + coturn) + TOWER deploy README; 4 tests. (`41fc7ad`)
- **MP-2 · WebRTC A/V client ✅** — anonymous identity, BrokerClient, PeerManager (perfect-negotiation +
  data channel), guarded media, Multiplayer view (join by room+password) + video tiles + mic/cam/leave;
  +41 tests. WebRTC/getUserMedia guarded → real A/V is **manual-verify** (jsdom can't). (`da3e19e`)

**Repo totals:** ~287 tests (160 Python + 127 UI; broker tests run separately). All on `main`, pushed to GitHub.

### Next: MP-3 (host-authoritative remote game sync) — the delicate keystone
This is cross-process + cross-language: the **GameEngine lives in the Python bridge**, so remote play means
a non-host player's `dart_hit` must travel bridge→UI→(WebRTC data channel)→host UI→host bridge engine,
which applies it (respecting turn ownership) and broadcasts `game_state` back. Touches the engine (turn
ownership / multi-source darts), the bridge WS (a "remote input" command), and the UI (data-channel relay)
+ reconnect/snapshot. **Best done with fresh context** — flagged for a focused next session.
Then: MP-4 profiles+avatars; quick parity wins (Count-Up, Medley); real app icons.

### MP-3 · Host-authoritative remote game sync ✅
Spec `docs/superpowers/specs/2026-05-22-mp3-remote-sync-design.md`; plan
`docs/superpowers/plans/2026-05-22-mp3-remote-sync.md`. Built subagent-driven on
`mp3-remote-sync` (fresh implementer + spec & code-quality review per task).

- **Engine:** `on_dart(dart, source_player_id=None)` with an opt-in active-player
  gate (`self._local_player_id is not None and source_player_id is not None and
  source != active`); `set_remote_role()` + `attach()` tags local darts. The gate is
  INERT for local play (default role `None`) so single-board multiplayer is unchanged.
- **Commands:** `remote_dart {bed, player}` + `set_remote_role {player}`.
- **UI:** pure `RemoteMatch` orchestrator (host forwards `game_state`, routes peer
  darts to `remote_dart`; guest forwards `dart_hit`, renders pushed state) with a
  runtime guard on untrusted peer messages; deterministic `hostRole()` election;
  `bridgeLink` pub/sub wiring the bridge WS to the Multiplayer view (fault-isolated
  subscribers); `PeerManager.onChannelOpen` reconnect snapshots; and a "Start remote
  match" panel + synced board in the Multiplayer view (unmount-safe lifecycle).
- **Tests:** +10 Python (3 command-parse + 7 turn-gate / alternating-sequence /
  local regression) → 173 Python; +21 UI (remoteMatch 12, bridgeLink 5, peerManager
  1, Multiplayer 3) → 189 UI. Full suites green; `npm --prefix ui run build` clean.
- **Manual E2E:** `docs/MANUAL-E2E-mp3.md` (two bridges + two UIs — WebRTC needs real browsers).
- **Known MVP gaps:** guest-miss not auto-detected; only host has controls; 2-player;
  host tab-switch mid-match pauses guest state-forwarding (gate stays armed).

**Next:** MP-4 profiles/avatars; quick parity modes (Count-Up, Medley); real app icons.

### MP-4 · Player profiles + avatars ✅
Spec `docs/superpowers/specs/2026-05-22-mp4-profiles-design.md`; plan
`docs/superpowers/plans/2026-05-22-mp4-profiles.md`. Built subagent-driven on `mp4-profiles`
(fresh implementer + spec & code-quality review per task). **UI-only — no Python/bridge/broker/engine changes.**

- **Profile:** extended the anonymous identity (`player.ts`) to `Profile {id, name, avatar:{color}}`
  with legacy `{id,name}` migration; `setPlayerColor`. Pure `avatar.ts` (`initials`, deterministic
  `defaultAvatarColor`, `AVATAR_PALETTE`); `<Avatar>` component.
- **Profile view:** new nav tab — edit name, pick avatar color, copy persistent ID, and see my
  career stats (from the existing `/api/history/stats`, matched by display name).
- **Multiplayer:** avatar travels in the broker `join` (the broker forwards the whole `player`
  dict); avatars on the local + peer video tiles (shown when a cam is off); opponent **stat card**
  (avatar, name, 3-dart avg / wins / games) exchanged symmetrically over MP-3's data channel via a
  new `{t:"card"}` message — `RemoteMatch` stays the single channel owner, with field-level
  validation of the untrusted card payload.
- **Tests:** UI-only — `avatar`/`player`/`careerSummary`/`Avatar`/`OpponentCard`/`VideoTile`/`Profile`
  + RemoteMatch card-exchange + Multiplayer avatar. Full UI suite **217 green**; `npm --prefix ui run
  build` clean. (Python suite unchanged at 173.)
- **Known limitations:** stats are keyed by display name and remote-match guest throws aren't
  recorded — so the opponent card reflects each player's *local* stats only. True per-identity,
  cross-device stats remain the deferred **server-side** profile feature. Avatars are initials+color
  (uploaded images deferred).

**Next:** quick parity modes (Count-Up, Medley); real app icons; (later) server-side profiles/accounts.

### Count-Up mode ✅ (quick parity)
Spec `docs/superpowers/specs/2026-05-22-count-up-mode-design.md`; plan
`docs/superpowers/plans/2026-05-22-count-up-mode.md`. Built subagent-driven on `count-up-mode`.

- **Engine:** new `CountUpMode` — N rounds (default 8) of 3 darts, every dart accumulates (bull 25 /
  dbull 50, no bust/checkout), highest total wins (ties → earlier player). One backward-compatible
  engine tweak: `_on_leg_won(result.winner or pid)` so the winner can be the highest scorer rather
  than whoever threw the final dart (inert for X01/Cricket/ATC, which set `winner == pid`).
- **UI:** `CountUpBoard` (per-player totals + "Round x / y" + leader crown); Count-Up in the local
  Setup form (with a rounds input) and the Multiplayer start-match select (default rounds remotely).
- **Tests:** +9 Python (scoring/rounds/end/highest-total-wins-incl-non-last-thrower/tie/default/option/
  multi-round-interleaving) → 182 Python; +4 UI (CountUpBoard ×2, Setup option/submit ×2) → 221 UI.
  Full suites + `npm --prefix ui run build` green.
- **Limitation:** assumes full 3-dart turns (round counter keys off the 3rd dart); early `next_player`
  isn't a supported Count-Up action.

**Next:** Medley (a match of sequenced games — its own sub-project); real app icons.

### Medley mode ✅ (quick parity)
Spec `docs/superpowers/specs/2026-05-22-medley-mode-design.md`; plan
`docs/superpowers/plans/2026-05-22-medley-mode.md`. Built subagent-driven on `medley-mode`.

- **Engine:** new `MedleyMode` — a match of a sequence of games (default `[x01, cricket, count_up]`),
  one per leg, run as **best-of-N** by the engine's existing best-of-legs machinery (`MedleyMode` sets
  `best_of_legs = len(sequence)`). It delegates each leg to the existing sub-mode and advances the
  sequence inside `on_start` (the engine's per-leg hook). Sequence/index live in `mode_view["medley"]`,
  so it is instance-stateless and undo-safe. **No engine logic change** — only a registry line.
- **UI:** `MedleyBoard` renders a "Game x / N — <mode>" header and delegates to the existing sub-board
  (X01/Cricket/ATC/Count-Up). Medley in the local Setup form (default sequence) + the Multiplayer
  start-match select.
- **Tests:** +6 Python (default sequence/first leg, leg-win advances the sequence, match ends at the
  majority of legs, unknown sub-mode aborts start, undo across a leg boundary, 2-player advance) →
  188 Python; +3 UI (MedleyBoard delegation ×2, Setup option) → 224 UI. Full suites + build green.
- **Limitations:** sub-modes use default options inside a medley (501 X01, 8-round Count-Up); a custom
  sequence-picker UI is deferred (the mode supports `options.sequence`); `free_play`/`medley` can't be
  sequence entries.

**Next:** real app icons; (later) server-side profiles/accounts.

### MP — Broker + coturn for real TOWER deployment
Spec `docs/superpowers/specs/2026-05-22-mp-broker-tower-deploy-design.md`; plan
`docs/superpowers/plans/2026-05-22-broker-tower-deploy.md`. Built on `broker-tower-deploy`.

- **Contained stack:** one `docker compose` (init + caddy + broker + coturn). Only `DOMAIN` required;
  `TURN_SECRET` auto-generates onto a shared volume. **Zero recurring maintenance** (Caddy auto-renews;
  coturn watcher reloads the cert via SIGHUP / restart).
- **Broker:** split into `turn.py` (HMAC REST creds) + `config.py` + `http.py`; single-port WS+HTTP
  (`/turn`, `/healthz` via `process_request`); hardened (64 KiB frame cap, room-count cap → `server_full`,
  optional Origin allowlist, structured logging, graceful SIGTERM). Pinned `websockets==15.0.1`,
  non-root image + HEALTHCHECK.
- **coturn:** `turn://` + `turns://` (reusing Caddy's Let's Encrypt cert), `--external-ip` for NAT,
  RFC1918 `--denied-peer-ip` SSRF hardening, pinned image.
- **Client:** `fetchIceServers` pulls short-lived TURN creds from `/turn` (STUN-only fallback); broker
  URL defaults via `VITE_BROKER_URL`.
- **Tests:** +12 server (turn×2/config×4/http×4/caps×2) and +8 UI (turn×6/store readBrokerUrl×2);
  server suite 16 passed; main Python suite 193 passed (no regressions); UI suite 232 passed; UI build
  clean. Real TLS/TURN traversal is manual-verify on TOWER (runbook in `server/README.md`).
- Broker tests require `pytest-asyncio` (declared in the `dev` extra; `asyncio_mode=auto` in pyproject) — install via the dev extra.
