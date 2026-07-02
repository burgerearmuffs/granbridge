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

### Server hardening v2

Spec `docs/superpowers/specs/2026-05-23-server-hardening-design.md`; plan
`docs/superpowers/plans/2026-05-23-server-hardening.md`. Built on `server-hardening`.

- **Per-IP rate limits (broker):** `RateLimiter` (sliding-window, zero deps) keyed by the real client
  IP from Caddy's authoritative `X-Real-IP`. Three independent limiters: `/turn` requests
  (`TURN_RATE_PER_MIN`, default 30), WebSocket upgrades (`CONN_RATE_PER_MIN`, default 60), and
  per-connection message flood for `signal`/`msg` (`MSG_RATE_PER_SEC`, default 20). `0` disables any
  limiter. Over-limit HTTP requests → 429; over-limit messages → silently dropped (sender stays connected).
- **coturn relay quotas:** entrypoint passes `--total-quota=${TURN_TOTAL_QUOTA:-200}` (max simultaneous
  relay allocations) and, when non-zero, `--max-bps=$TURN_MAX_BPS` (per-allocation bytes/sec cap).
- **ACME email:** `caddy` service injects a `{ email ... }` global block at startup when `ACME_EMAIL`
  is set in `.env`; no-op when unset. Ensures Let's Encrypt sends renewal/expiry notices.
- **ALLOWED_ORIGINS documented:** comma-separated browser-origin allowlist for browser-only deployments;
  leave unset for the native app (null origin bypasses enforcement by design).
- **Tests:** server suite **30 passed** (16 prior + 14 new: `test_ratelimit.py` ×10 + `test_rate_limits.py` ×4);
  main Python suite 193 passed (no regressions); UI suite 232 passed; `npm run build` clean.

### Server deployment smoke tool

Plan `docs/superpowers/plans/2026-05-23-server-smoke-tool.md`. Built on `server-smoke-tool`.

- **`server/smoke.py`** — zero-dependency CLI (`urllib` only) that validates a live broker deployment
  from the client side. Checks: `/healthz` (broker up, `status: ok`), `/turn` (credential payload
  has `username`, `credential`, and non-empty `uris`), and a `wss://` connect + room `join` handshake.
  The WS check (`check_ws`) requires the `websockets` package; without it the check reports SKIP
  and the tool still exits 0 if the HTTP checks pass. Actual TURN *relay* needs a real WebRTC peer
  and remains a browser manual-verify — the tool says so explicitly.
- **Integration test** (`server/tests/test_smoke.py`) — spins up a real `BrokerServer` on a loopback
  port and runs all three `check_*` functions against it over a live TCP socket, closing the coverage
  gap where `/healthz` and `/turn` were only exercised through mocked handler calls, not a real HTTP
  request/response cycle. Also covers `_http_base` scheme mapping, dead-endpoint failure, missing-scheme
  rejection, SKIP behaviour when `websockets` is absent (via `sys.modules` patching), and edge-case URL
  forms.
- **Server suite total: 36 passed** (30 prior + 6 new in `test_smoke.py`). Main Python suite 193
  passed (no regressions); UI suite 232 passed.

### Smoke tool — STUN reachability check

Plan `docs/superpowers/plans/2026-05-23-smoke-stun-check.md`. Built on `smoke-stun-check`.

- **`server/smoke.py`** extended with a STUN Binding check (RFC 5389): `build_stun_binding_request`
  (20-byte packet, random transaction ID), `parse_xor_mapped_address` (IPv4 XOR-MAPPED-ADDRESS),
  and `check_stun(host, port=3478)` which sends one UDP Binding Request and confirms coturn responds.
  Wired into `run()` after `check_turn`; host derived from the broker URL, port fixed at 3478. This
  catches a firewall blocking UDP 3478 — a common deployment failure that `/healthz` cannot detect.
- **`server/tests/test_smoke_stun.py`** — 5 pure unit tests: packet shape (type/length/magic),
  XOR-MAPPED-ADDRESS roundtrip (1.2.3.4:1234), garbage-input returns `None`, and dead-host timeout
  returns `(False, ...)` with "stun" in the detail. No live network required.
- **Server suite total: 41 passed** (36 prior + 5 new in `test_smoke_stun.py`). Main Python suite
  and UI suite (232) unchanged.

### TURN relay auto-check

Plan `docs/superpowers/plans/2026-05-23-turn-relay-check.md`. Built on `turn-relay-check`.

- **`server/smoke.py`** extended with `check_turn_relay`: a two-step authenticated TURN Allocate
  (RFC 5766 + RFC 5389 long-term credentials). Step 1 sends an unauthenticated Allocate to elicit
  a 401 with REALM + NONCE; Step 2 sends a properly-keyed Allocate with MESSAGE-INTEGRITY
  (HMAC-SHA1 over the full header+body, with the length-trick: the header Message-Length already
  includes the 24-byte MI attribute). On success (Allocate 0x0103), the relay address is parsed
  via `parse_xor_mapped_address`. Credentials are fetched live from `/turn` by `run()`. This
  confirms coturn accepts the broker's HMAC-minted credentials and allocates a relay over UDP 3478
  **without a browser**.
- **Pure unit tests** (`server/tests/test_turn_relay.py`, 4 tests): long-term key derivation
  (MD5 hash), full authed-Allocate structure + MI value, `_get_attr` extraction, and
  XOR-RELAYED-ADDRESS parsing.
- **Docker-gated integration tests** (`server/tests/test_turn_relay_integration.py`) — the
  correctness oracle: spins up a real `coturn:4.6.2` container, mints credentials via
  `granbridge_broker.turn.make_turn_credentials`, and calls `check_turn_relay` against it. Because
  coturn validates the HMAC itself, a successful Allocate proves the key derivation, MI length-trick,
  and attribute encoding are all correct. Skipped automatically when Docker is absent.
- **Server suite total: 47 passed** (41 prior + 6 new: 4 pure unit tests + 2 docker-gated
  integration tests). Main Python suite 193 passed (no regressions); UI suite 232 passed.

### Server-side stats backend (2026-05-24, branch `server-side-stats`)

Spec `docs/superpowers/specs/2026-05-24-server-side-stats-design.md`; plan
`docs/superpowers/plans/2026-05-24-server-side-stats-backend.md`.

- **`StatsStore`** (`server/granbridge_broker/stats.py`) — SQLite-backed, identity-keyed match
  stats. Schema: `players` (TOFU token hash, display name, avatar), `matches` (per-reporter summary
  row + co-sign verification), `match_throws` (optional per-dart heatmap rows). WAL mode; one
  connection per call (safe for `asyncio.to_thread`). Persisted to the `data` Docker named volume
  at `STATS_DB_PATH=/data/stats.db`.
- **Write path:** `stats_submit` WebSocket message (WS used instead of `POST` because
  `websockets 15`'s `process_request` cannot read an HTTP body). TOFU auth: first writer for a
  player id registers `sha256(token)`; all later writes must match. Sanity caps: `darts ≤ 5000`,
  `total_scored ≤ darts × 60` (bounding 3-dart avg to ≤ 180). Reply: `stats_ack` on success or
  `error` with codes `token_mismatch`, `implausible`, `unsupported`, `rate_limited`, `bad_request`.
- **Read path:** `GET /stats/player/{id}` (summary + heatmap) and `GET /stats/leaderboard`
  (verified-only, min 3 verified games, sortable by `avg` or `wins`). Both served on the broker's
  single port via `_process_request`.
- **Verified matches:** a match is co-signed when two reporters submit the same `match_id` with
  the same `winner_id`; disagreeing reporters remain unverified. Solo matches never verify. Only
  verified matches appear on the leaderboard — preventing stat inflation from uncontested
  submissions.
- **Refinements vs. spec:** (1) writes are a WS `stats_submit` message, not `POST /stats/submit`
  — required by `websockets 15`'s `process_request` design; (2) `matches` carries summary columns
  (`darts`, `total_scored`); per-throw `match_throws` is optional (stored only when supplied) —
  this resolves the spec's guest-recording open item: a guest can submit an aggregate contribution
  without server-side guest recording.
- **`/healthz`** now returns `players` and `matches` counts when stats are enabled.
- **`smoke.py`** extended with `check_stats`: submits a throwaway match over WS then reads it
  back via `GET /stats/player/{id}`, confirming the full round-trip.
- **Ops:** `data` named volume in `docker-compose.yml` mounted at `/data`; `STATS_DB_PATH` and
  `STATS_RATE_PER_MIN` (default 30) env vars; documented in `server/README.md` (wire shapes,
  TOFU auth, backup: `docker compose cp broker:/data/stats.db ./stats-backup.db`).
- **Tests:** 19 new server tests across `test_stats_store.py` (9: schema/TOFU/idempotency/
  validation/verification), `test_stats_api.py` (9: HTTP GET reads, WS submit/ack/errors,
  smoke round-trip), `test_stats_integration.py` (1: persistence across StatsStore reopen,
  simulating container restart on a mounted volume). **Server suite: 66 passed** (47 prior +
  19 new). Main Python suite 193 passed (no regressions); UI suite 232 passed.
- **Client integration is Plan 2** (app `export/latest`, UI identity/recovery-key/match-id/
  stats-client/offline-queue, Profile/Multiplayer/Leaderboard surfaces, upload toggle).

### Client stats ingestion — Plan 2a (2026-05-24, branch `server-side-stats-client`)

Spec `docs/superpowers/specs/2026-05-24-server-side-stats-client-design.md`; plan
`docs/superpowers/plans/2026-05-24-server-side-stats-client-2a-foundation.md`.

- **`writeToken` identity + recovery-key codec** — `ui/src/multiplayer/player.ts` gains a
  `writeToken` UUID persisted in `Profile` (with a migration that generates one for existing
  profiles). `ui/src/multiplayer/recoveryKey.ts` is a pure, stateless encode/decode codec
  (base64url over `player_id:writeToken`) — no persistence, no side effects.
- **`statsClient`** (`ui/src/stats/statsClient.ts`) — `brokerHttpBase` derives the HTTP origin
  from the WS URL. `submitMatch` opens a transient WebSocket, sends `stats_submit`, and resolves
  on `stats_ack` (or rejects on `error`). `fetchPlayerSummary` and `fetchLeaderboard` are plain
  HTTP GETs to `/stats/player/{id}` and `/stats/leaderboard`.
- **Offline `statsQueue`** (`ui/src/stats/statsQueue.ts`) — localStorage FIFO keyed by match id.
  `enqueue` adds an entry tagged as `terminal` (local full-throw match) or `transient` (remote
  aggregate). `flushStatsQueue` drains the queue serially (promise-chain, one at a time): transient
  entries are discarded if submission fails; terminal entries are retried on the next flush. This
  ensures at-least-once delivery for fully-owned matches while never blocking the UI.
- **`uploadPref` toggle** (`ui/src/stats/uploadPref.ts`) — `getUploadEnabled`/`setUploadEnabled`
  backed by `localStorage`; defaults to `true`. Checked by the submission hook before any network
  call.
- **`/api/history/export/latest` endpoint** — `src/granbridge/history/store.py` gains
  `export_latest_match()` (returns the most recent finished match from the history SQLite store as
  a `MatchRecord`-shaped dict). `src/granbridge/cli.py` registers the route
  `GET /api/history/export/latest`; the UI calls this to assemble the full-throws payload for
  local matches. Covered by `tests/test_history_export.py` (2 tests).
- **Host-minted shared remote `match_id`** — `ui/src/multiplayer/remoteMatch.ts` gains a
  `{t:"matchid", id}` `SyncMsg` and `onMatchId` callback. The host generates a UUID and broadcasts
  it to the guest over the existing data channel at game-start. `writeToken` is deliberately
  stripped from the data-channel profile card before send — it never leaves the local browser.
  `ui/src/multiplayer/store.ts` tracks `remoteMatchId` with `setRemoteMatchId` and clears it in
  `resetMp`.
- **`useStatsSubmission` hook** (`ui/src/stats/useStatsSubmission.ts`) — mounted once in
  `App.tsx`. Watches for `gamePhase === "finished"`. Two assembly paths: (1) **local** — fetches
  full throws from `/api/history/export/latest` and enqueues a `terminal` entry; (2) **remote** —
  builds an aggregate-only `MatchRecord` (darts + total\_scored, no per-throw data) from the
  Zustand game store and enqueues a `transient` entry keyed on `remoteMatchId`. Remote stats are
  intentionally aggregate-only — no per-segment heatmap is ever sent for multiplayer matches.
  After a remote submission, `remoteMatchId` is cleared in the store. The hook also fires
  `flushStatsQueue()` on startup (via `useEffect` in `App.tsx`) to drain any entries left over
  from a previous session.
- **Tests:** new files `recoveryKey.test.ts`, `statsClient.test.ts`, `statsQueue.test.ts`,
  `uploadPref.test.ts`, `useStatsSubmission.test.tsx`, `store.remoteMatch.test.ts`,
  `remoteMatch.matchid.test.ts`; existing player + App tests extended. **UI suite: 260 passed**
  (232 prior + 28 new). Python export suite: 2 passed. Server suite: 71 passed (no regressions).
- **Plan 2b (surfaces) is next:** Profile recovery UI + server-stats card + upload-toggle control,
  opponent card populated from `/stats/player/{id}`, and a full Leaderboard view.

### Client stats surfaces — Plan 2b (2026-05-24, branch `server-side-stats-client-2b`)

Spec `docs/superpowers/specs/2026-05-24-server-side-stats-client-design.md` (§7–9); plan
`docs/superpowers/plans/2026-05-24-server-side-stats-client-2b-surfaces.md`.

- **`toCareerSummary` mapper** — `ui/src/stats/statsClient.ts` gains `toCareerSummary(PlayerSummary):
  CareerSummary` (defensive: gracefully handles missing / zero denominator). Shared by Profile and
  Multiplayer so the rest of the UI consumes the existing `CareerSummary` shape regardless of data source.
- **Profile — server career card** — `Profile.tsx` now calls `fetchPlayerSummary` on mount, maps the
  result via `toCareerSummary`, and displays the server career stats (3-dart avg, wins, games played).
  Falls back to the local `fetchMyCareerSummary` result when the broker is unreachable, so the card
  always renders.
- **Profile — recovery-key export/import** — a "Backup / restore your identity" panel: Export copies
  the base64url recovery key to the clipboard; Import accepts a paste of the recovery key and calls
  `applyRecoveryKey`, migrating the profile in-place. Errors are shown inline; the panel is read-only
  until the user clicks "Show / change".
- **Profile — upload toggle** — a checkbox ("Share stats with the server") backed by
  `getUploadEnabled`/`setUploadEnabled`. Matches the upload pref the submission hook already reads.
- **In-match opponent card — server-preferred** — `Multiplayer.tsx` enriches the opponent card by
  calling `fetchPlayerSummary` for the peer's player id when the card arrives over the data channel.
  Falls back to the data-channel `CareerSummary` payload when the fetch fails or the broker is
  unreachable, so the card is always shown.
- **Leaderboard view** (`ui/src/views/Leaderboard.tsx`) — standalone view: calls `fetchLeaderboard`
  on mount, displays a ranked table (rank, avatar, display name, 3-dart avg, wins, games) for verified
  players only, with an avg/wins toggle to switch the sort metric. Shows a loading state while fetching
  and an empty-state message when no verified players exist yet.
- **Leaderboard nav tab** — `App.tsx` adds a `"leaderboard"` tab to the bottom nav bar and a render
  branch that shows `<Leaderboard />` when active.
- **Tests:** `statsClient.reads.test.ts` extended (toCareerSummary mapper); `Profile.test.tsx`
  rewritten with a URL-aware fetch mock covering server card, local fallback, recovery-key
  export/import, and upload toggle; `Leaderboard.test.tsx` (new: render/rank/toggle/empty/error
  states); `App.test.tsx` extended (leaderboard tab). **UI suite: 301 passed** (260 prior + 41 new).
  Server and Python suites unchanged.
- **Server-side stats client is now feature-complete:** Plan 2a delivered identity + `statsClient` +
  offline queue + match submission; Plan 2b delivers all UI surfaces (Profile, Multiplayer opponent
  card, Leaderboard). The full server-side stats pipeline — ingestion (backend) → submission (2a) →
  display (2b) — is end-to-end built.


---

## 2026-06-12 — Production push: hardening, Settings, chat + turn clock, spectators, onboarding, tournaments (v0.1.5, PRs #12–#18)

Autonomous production-readiness pass across six merged PRs:

- **Hardening (PR #12)** — bridge WS reconnect backoff (0.5s→8s cap, reset on open);
  `acquireLocalMedia()` reports *why* camera/mic failed (unsupported/denied/failed) and the
  Multiplayer view shows a dismissible notice instead of silently joining without A/V; checkout
  3-dart search memoized (`lru_cache`, tuple-backed); public `GameEngine.flush()` (cli no longer
  pokes `_flush`); jsdom canvas stub removes the standing vitest unhandled error. Review also marked
  two FOLLOWUPS items stale: `overrides_path` already lives in `%LOCALAPPDATA%`, and the placeholder
  icons were already replaced by the dartboard set.
- **Settings view (PR #14)** — sixth nav tab: camera/mic device pickers (persisted; used via
  `buildConstraints` with `deviceId.ideal` fallback semantics; "Test camera" live preview doubles as
  the permission grant), broker URL editor with ws/wss validation + reset-to-default, clear local
  match history (new `POST /api/history/clear`; `StaticServer` grew `post_routes`,
  `HistoryStore.clear_all()`), manual update check. App nav refactored to a `NAV_TABS` map.
- **Chat + turn clock (PR #15)** — data-channel protocol grew validated `{t:"chat"}` (500-char cap,
  React-escaped render, 200-line transcript, unread badge; open in lobby, collapsed in-game) and
  `{t:"clock"}` (host announces Off/30/45/60s, persisted pref, re-sent on channel re-open; advisory
  countdown chip that resets per active player and never auto-advances).
- **Spectator mode (PR #16)** — broker `join` accepts `spectator: true`: spectators are invisible to
  `peers` (host election untouched), capped separately (`SPECTATOR_CAP`, default 8), read-only
  (signal/msg rejected); `joined`/`peers` carry a `spectators` count. Client "Watch only" join skips
  media/ICE/PeerManager/RemoteMatch and renders `{t:"spectate_state"}` broker msgs that the host
  mirrors only while spectators are present (+ immediate push when one joins). Watch-only view +
  "N watching" chips.
- **Onboarding (PR #17)** — first-run 3-step modal (name+avatar → tab tour → recovery-key copy),
  `granbridge.onboarded` flag, kiosk-suppressed; recovery-key backed-up tracking with an amber
  Profile banner until the key is copied (onboarding or Profile export both satisfy it).
- **Tournaments (PR #18)** — local single-elimination bracket (2–8 players, one board): pure
  `tournament/bracket.ts` (byes to first seeds, immutable winner propagation), persisted store
  (`granbridge.tournament`), Tournament tab with bracket grid, "Play this match" → `start_game` over
  the bridge, auto-advance on the board's finished state (stale-state guarded), manual fallback,
  champion banner.

**Suites at end of pass:** bridge 204 passed · server 80 passed (+4 docker-gated env errors) ·
UI 444 passed. Versions bumped to 0.1.5.

---

## 2026-06-12 — v0.1.5 SHIPPED + fast-follow features (PRs #20–#22, v0.1.6)

- **v0.1.5 released** (signed, full, all 6 assets; update chain verified end-to-end). Server
  release **server-v0.3.0** (spectator role) cut alongside.
- **PR #20** — relay-only joins now abort with a clear error when `/turn` yields no ICE servers
  (was a silent hang; known follow-up from the 443-only change). Spectator joins never consult
  `/turn`.
- **PR #21** — MP lobby match options (301/501/701 + best-of-legs for X01/Cricket); shareable
  result card (clipboard text + canvas PNG, jsdom-safe); offline commentary enabled by default
  (`plugins_enabled = ["commentary"]`) with a new `commentary` UI event + `CommentaryTicker`
  caption in LiveGame.
- **PR #22** — spectator chat relay (`{t:"spectate_chat"}` host mirror, read-only ChatPanel in
  the watch view); README rewritten to current reality (intro + Multiplayer section).

**Suites:** bridge 205 · server 80 (+4 docker-gated) · UI 464. Versions bumped to 0.1.6.

---

## 2026-06-13 — v0.1.7: dual cameras, announcement videos, aesthetics (PR #24)

- **Multi-camera per player:** Settings board-cam picker; session acquires a second video-only
  stream; PeerManager sends per-stream-tagged tracks and the receiver regroups by sender stream
  id (face first, board second); opponent board view in the in-game rail + lobby tiles.
- **Announcements:** AnnounceKey clips (treble-twenty/nineteen/eighteen, bullseye, one-eighty)
  share VIDEO_MANIFEST's drop-a-file slots with procedural gold-flash fallback; store-side
  detection incl. a visit-score mirror for 180s; AnnouncementOverlay below CheckoutOverlay.
- **Aesthetics:** app backdrop vignette, brand-title gradient, nav glow, VideoTile ring +
  label scrim, gradient banners, glass MP rail.

**Suite:** UI 485 passed. Version bumped to 0.1.7.

---

## 2026-07-01 — AV assets: real sounds, celebration videos, polish (PR #28)

- **Sound:** nine self-generated MP3s (tools/make_sounds.py — numpy layered synthesis:
  sisal thuds, shaped-noise crowd roars, brass fanfares, convolution reverb) shipped in
  ui/public/sounds/; new FilePack (TDD) with three-tier loading — fetch+decodeAudioData →
  HTMLAudioElement probe → per-sound SynthPack fallback; app singleton plays real audio.
- **Video:** seven procedurally rendered MP4s (tools/make_videos.py — PIL→ffmpeg, 960×540@30):
  GAME SHOT!, LEG!, 180 triple-flash, T20/T19/T18, BULLSEYE ring-zoom; fill every
  VIDEO_MANIFEST slot within the overlay duration caps.
- **Polish:** backdrop grain + layered vignette, glassier board container, 250 ms video
  fade-in (reduced-motion safe). Drive-by: Profile bio-sync catch guard.
- **Verified end-to-end:** live-browser run exposed a fetch-filtering environment (audio/mpeg
  → empty 204); the element tier was added and verified to recover — real audio confirmed
  playing under filtering, MP4s canplaythrough.

**Suite:** UI 508 passed (66 files), build green.

---

## 2026-07-02 — Final-polish pass (PR #29)

- **Favicon/web icons** from the dartboard source (make_icon.py extended) — no more 404/blank tab.
- **Entrance themes:** Gold Standard / Cool Runnings / Inferno walk-ons (text-free background
  clips + fanfares via tools/make_entrances.py); Profile picker; EntranceOverlay fires on the
  Start Game gesture, click/Escape to skip, video-settings + reduced-motion aware.
- **Own-your-data export:** HistoryStore.export_all() at /api/history/export/all; History tab
  Export JSON (canonical granbridge.history.v1) / Export CSV (row per throw).
- **Disconnect UX:** prominent mid-game banner distinguishing board reconnects from bridge
  outages (header badge is tiny and absent in kiosk mode).
- **FOLLOWUPS audit:** everything actionable was already fixed (bounded queues, origin guard,
  AppData paths, checkout lru_cache, public flush(), log sinks); heartbeat/button documented
  RESERVED; FOLLOWUPS.md now truthful. A11y: Escape-skip + badge status label.
- **Docs:** QUICKSTART/README cover sounds/videos, volume, drop-a-file customization,
  entrance themes, export.
- **Verified:** 207 Python + 532 UI tests, builds green; live smoke — favicon 200s, entrance
  overlay end-to-end in a real browser ("Now throwing: Willa", inferno clip playing).

**Suite:** UI 532 passed (69 files), bridge 207 passed. → v0.1.9 release next.
