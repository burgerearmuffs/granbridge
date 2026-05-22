# GRANBRIDGE

Modern, Windows-first BLE bridge for GRANBOARD 3s dartboards. Receives live dart
hits over Bluetooth LE and exposes them as structured JSON over WebSocket, with a
transparent OBS overlay. The bridge runs headless and is usable without any UI.

## Milestone 1 — what works
- Connects to a GRANBOARD over BLE on Windows 11 (auto-reconnect, watchdog).
- Decodes dart hits into structured JSON events.
- Streams events over a local WebSocket (`ws://127.0.0.1:8787`).
- A browser overlay updates live (usable as an OBS Browser Source).
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

The `commentary` plugin listens to bus events and publishes `commentary` events with human-readable call-outs (e.g. "Treble twenty!", "One hundred and eighty!", "Game shot!"). A `TemplateCommentator` covers key moments offline. An `LLMCommentator` seam is ready for injection of any LLM provider callable.

```
GRANBRIDGE_PLUGINS_ENABLED=["commentary"]
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

**Native app (Tauri):** Once Rust is installed (`rustup`), build the native desktop app:
```
cd ui
cargo tauri build
```
The Tauri scaffold lives in `ui/src-tauri/`. The `tauri.conf.json` points `frontendDist` to `../dist` and dev to `http://localhost:5173`, window 1280×800 resizable, identifier `com.granbridge.app`.
