# GRANBRIDGE

Modern, Windows-first darts platform for GRANBOARD 3s dartboards: a BLE bridge +
game engine (Python, headless-capable) and a polished desktop app (React +
Tauri) for local play, internet multiplayer with live video, and streaming.

> **Just want to play?** Grab the installer from the
> [latest release](https://github.com/burgerearmuffs/granbridge/releases/latest)
> and read [`QUICKSTART.md`](QUICKSTART.md). The rest of this README is for
> developers and self-hosters.

## What it does
- **Board → engine:** connects to a GRANBOARD over BLE (auto-reconnect),
  decodes hits into structured JSON events, and drives a full game engine —
  X01 (legs + sets, double-out, checkout hints), Cricket, Around the Clock,
  Count-Up, Free Play, Medley.
- **Desktop app:** live scoreboard with a 3D dartboard, match history +
  heatmap, profiles with server-backed career stats and a verified
  leaderboard, a Settings tab (A/V devices, broker, local data), first-run
  onboarding, offline commentary captions, shareable result cards, and
  auto-updates.
- **Sound & spectacle:** real self-generated sound effects (dart thuds,
  crowd-roar fanfares) with a volume control, full-screen celebration clips
  (GAME SHOT!, LEG!, 180, treble/bullseye), and per-player **entrance
  themes** (walk-on video + fanfare). Every clip is a drop-a-file replaceable
  asset under `ui/public/{sounds,videos}/` — regenerate them all from
  `tools/make_sounds.py`, `tools/make_videos.py`, `tools/make_entrances.py`.
- **Own your data:** one-click **Export JSON / CSV** of your complete match
  history (every game, every dart) from the History tab, plus a documented
  local SQLite DB under `%LOCALAPPDATA%\granbridge`.
- **Internet multiplayer:** room + password matches with two-way camera/mic
  over WebRTC (relay-only TURNS over 443), host-authoritative game sync, text
  chat, an optional turn clock, guest controls + rematch — and **spectators**
  who can watch any room live.
- **Tournament night:** local single-elimination brackets for 2–8 players on
  one board.
- **Streaming:** OBS browser-source overlays (scoreboard, checkout, throw,
  stats, lower-third, broadcast composite) + a kiosk mode.
- Fully testable without hardware via a fake/replay transport.

## Quickstart (Windows 11)
1. `python -m venv .venv; .venv\Scripts\python -m pip install -e ".[dev]"`
2. Wake the board. `.venv\Scripts\granbridge scan` — confirm it appears.
3. `.venv\Scripts\granbridge calibrate` — throw at the prompted beds to map your board.
4. `.venv\Scripts\granbridge serve` — streams events on ws://127.0.0.1:8787.
5. Add `src/granbridge/overlay/index.html` as an OBS Browser Source.

## Streaming: dual player-cams
Add `src/granbridge/overlay/broadcast.html` as a second OBS Browser Source for a
broadcast layout with two webcam feeds + the live score. Grant camera permission
once. Optionally pin specific webcams with query params:
`broadcast.html?cam1=Logitech&cam2=OBS` (matches on device-label substring).

## Event contract
Events are JSON with `schema_version`, `type`, `timestamp`. Example dart hit:
`{"type":"dart_hit","bed":"T20","ring":"T","segment":20,"multiplier":3,"score":60, ...}`
JSON Schemas live in `src/granbridge/events/schema/`.

## Architecture
BLE → FrameAssembler → Decoder(SegmentMap) → EventBus → {JSON log, WebSocket} → overlay.
The BLE bridge is independently usable without any frontend. See
`docs/superpowers/specs/2026-05-21-granbridge-ble-bridge-design.md`.

## Integrations / plugins

GRANBRIDGE has an optional plugin system that routes every bus event to one or more
external services. Plugins are error-isolated (one crashing plugin does not affect others)
and no-op when their endpoint is not configured.

### Install optional deps

```
.venv\Scripts\python -m pip install -e ".[dev,integrations]"
```

### Enable plugins

Set `GRANBRIDGE_PLUGINS_ENABLED` (comma-separated, via env or a `.env` file) and supply
per-plugin config under `GRANBRIDGE_PLUGINS__<NAME>__<KEY>`:

```
GRANBRIDGE_PLUGINS_ENABLED=["logging","mqtt","discord","wled"]
GRANBRIDGE_PLUGINS__MQTT__HOST=192.168.1.50
GRANBRIDGE_PLUGINS__MQTT__PREFIX=granboard
GRANBRIDGE_PLUGINS__DISCORD__WEBHOOK_URL=https://discord.com/api/webhooks/...
GRANBRIDGE_PLUGINS__WLED__HOST=192.168.1.60
GRANBRIDGE_PLUGINS__WLED__WIN_FX=80
```

### Available plugins

| Name | What it does | Requirements |
|------|-------------|--------------|
| `logging` | Logs every event via structlog | none |
| `mqtt` | Publishes dart hits to `<prefix>/throw`, other events to `<prefix>/event` | MQTT broker (`aiomqtt`) |
| `discord` | Posts game-won / leg-won messages to a Discord webhook | Discord webhook URL (`httpx`) |
| `wled` | Triggers LED effects on a WLED controller on game-won / bust | WLED host reachable on LAN (`httpx`) |

Plugins that require a network endpoint (mqtt, discord, wled) are silent no-ops if the
endpoint is not configured — no errors, no broken serve.

## Future foundations

These features are implemented as testable foundations but are not yet production-ready. Each has a clear flag on what is needed before going live.

### Multiplayer relay (`granbridge relay`)

Run a local room-based rebroadcast server so multiple clients can share a live game session:

```
.venv\Scripts\granbridge relay --host 127.0.0.1 --port 8788
```

Clients connect via WebSocket with a `?room=<id>` query param. Every message from one client in a room is forwarded to all other clients in the same room.

**Flag:** The relay has no authentication, TLS, or access control. It is safe for localhost/LAN use. Hosting it publicly requires adding auth, TLS termination, and rate limiting.

Enable the relay plugin (forwards local bus events to a remote relay room):

```
GRANBRIDGE_PLUGINS_ENABLED=["relay"]
GRANBRIDGE_PLUGINS__RELAY__URL=ws://127.0.0.1:8788
GRANBRIDGE_PLUGINS__RELAY__ROOM=mygame
```

### AI commentary plugin

The `commentary` plugin listens to bus events and publishes `commentary` events with human-readable call-outs (e.g. "Treble twenty!", "One hundred and eighty!", "Game shot!"). A `TemplateCommentator` covers key moments offline; the desktop UI renders the lines as a broadcast-style caption. An `LLMCommentator` seam is ready for injection of any LLM provider callable.

**Enabled by default** since v0.1.6. Disable (or change the plugin set) with:

```
GRANBRIDGE_PLUGINS_ENABLED=[]
```

**Flag:** For richer LLM-generated commentary an API key and a `generate` callable backed by an LLM provider must be injected into `LLMCommentator`. Text-to-speech output requires an additional TTS integration (not included).

### Camera CV validation (architecture only)

A `Validator` / `NoOpValidator` seam lives in `src/granbridge/vision/validator.py`. The current default (`NoOpValidator`) trusts the board's BLE sensor entirely. A future camera-based implementation would cross-check each `dart_hit` against multi-view video analysis and emit a `validation` event on disagreement.

See `docs/camera-validation-architecture.md` for the full rig, calibration, and detection pipeline design. No CV code is implemented — the seam is the integration point.

## Packaged app (Windows)

GRANBRIDGE ships as a self-serving Windows executable — no Python, no venv, no npm dev
server required. The exe bundles the bridge, the built UI, and all overlays.

**Build:**
```
.venv\Scripts\python -m PyInstaller packaging/granbridge.spec --noconfirm --distpath dist --workpath build/pyi
```
Output lands in `dist\granbridge\granbridge.exe`.

**Run (double-click or terminal):**
```
dist\granbridge\granbridge.exe
```
With no arguments the exe runs `serve --open`: it starts the bridge on
`ws://127.0.0.1:8787`, serves the UI at `http://127.0.0.1:8080`, and opens the browser
automatically.

**CLI subcommands still work inside the exe:**
```
dist\granbridge\granbridge.exe scan
dist\granbridge\granbridge.exe calibrate
dist\granbridge\granbridge.exe serve --no-open
```

**Tauri sidecar:** The produced exe is the sidecar the native Tauri app (Step 2b) bundles
— not throwaway. Configure `tauri.conf.json` to embed `granbridge.exe` as an external binary.

## Tests
`.venv\Scripts\python -m pytest` — all tests are hardware-free (fake/replay transport).

## Desktop UI

A React+TypeScript+Tailwind+Zustand web app that connects to the GRANBRIDGE WebSocket and drives live games via the bidirectional command channel. Tauri-ready for a native Windows app.

**Dev server (browser):**
```
cd ui
npm install
npm run dev
```
Opens at `http://localhost:5173`. The app connects to `ws://127.0.0.1:8787` — run `granbridge serve` first.

**Kiosk / OBS mode:** append `?kiosk=1` to hide the header/badge — ideal for fullscreen overlays.

**Run tests:**
```
npm --prefix ui test
```

**Web build:**
```
npm --prefix ui run build
```
Output lands in `ui/dist/`.

## Native app (Tauri)

A polished portable Windows desktop app that launches the GRANBRIDGE bridge automatically
and shows the React UI in a native window. Built with Tauri v2 + a PyInstaller onefile sidecar.

**Prerequisites:**
- Rust (msvc target): `winget install Rustlang.Rustup` then `rustup target add x86_64-pc-windows-msvc`
- WebView2 Runtime (pre-installed on Windows 11)
- Node 18+ + npm

**Build the installer:**
```
cd ui
npm install
npx tauri build
```
Output installers under `ui/src-tauri/target/release/bundle/`:
- `msi/GRANBRIDGE_<ver>_x64_en-US.msi`
- `nsis/GRANBRIDGE_<ver>_x64-setup.exe`

**How it works:** The native app bundles `granbridge.exe` (a PyInstaller onefile sidecar) and
spawns it as `granbridge serve` on startup via `tauri-plugin-shell`. Tauri shows the React UI
in its own window; the UI connects to `ws://127.0.0.1:8787` as usual.

**Rebuild the sidecar exe** (needed when Python code changes):
```
.venv\Scripts\python -m PyInstaller packaging/granbridge-sidecar.spec --noconfirm --distpath dist/sidecar --workpath build/pyi-sidecar
copy dist\sidecar\granbridge.exe ui\src-tauri\binaries\granbridge-x86_64-pc-windows-msvc.exe
```
Then re-run `npx tauri build` from `ui/`.

**First run after installing:** Run `granbridge calibrate` once from the CLI exe
(`dist\granbridge\granbridge.exe calibrate`) to map your board. Calibration data is stored
in your user profile and survives app reinstalls.

## Multiplayer

Two players, each on their own board, play one shared match with two-way
camera/mic. The broker (`server/`) handles rooms, presence, WebRTC signaling
and short-lived TURN credentials; media and game sync travel peer-to-peer
(relayed through coturn over TLS/443 when NATs demand it).

### How to use

1. Both players open the **Multiplayer** tab and enter a display name, the same
   **Room ID** + **Password**, and the **Broker URL** (defaults to the hosted
   broker, `wss://darts.aventador.io/`; persists to localStorage and is also
   editable in **Settings**). For LAN/dev, run the broker locally
   (`.venv\Scripts\python -m granbridge_broker`) and use `ws://127.0.0.1:8788`.
2. Click **Join** — camera/mic permission is requested once (pick devices in
   **Settings**, with a live test preview). If access is denied you still join,
   with a notice explaining how to fix it.
3. The **host** (elected automatically) picks the mode, start score
   (301/501/701), best-of-legs, and an optional **turn clock** (30/45/60s) and
   clicks **Start match**. Both boards feed the one shared game — the host's
   engine is authoritative; the guest gets miss/undo/correct/rematch request
   controls.
4. **Chat** any time via the in-room text chat (collapsible in-game, unread
   badge).
5. **Spectators:** anyone with the room + password can tick **Watch only** —
   no camera needed; they see the live board, score, and the players' chat
   (read-only). Players see a "👁 N watching" count.

### Architecture notes

- **Identity:** anonymous UUID profile (`granbridge.player` in localStorage) +
  a private write-token whose base64 export is the **recovery key** for
  server-side career stats (TOFU auth; export it from Profile).
- **TURN is automatic:** the client fetches short-lived TURNS credentials from
  the broker's `/turn` endpoint at join and forces relay-only ICE, so matches
  work through NATs with only TCP 443 open server-side. If `/turn` is
  unreachable the join fails with a clear error instead of hanging.
- **Perfect negotiation** (polite/impolite by lexicographic peer id) over the
  broker's signal relay; **data channel** `granbridge` carries game sync
  (`state`/`dart`), profile cards, chat, the turn clock, and guest requests.
- **Spectator relay:** while spectators are present, the host mirrors
  authoritative `game_state` (and chat) to the room as broker `msg` broadcasts;
  spectators are invisible to host election and read-only at the server.
- Self-hosting the broker (Docker, 443-only, coturn): see [`server/`](server)
  and `server/CHANGELOG.md`.
