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

## Tests
`.venv\Scripts\python -m pytest` — all tests are hardware-free (fake/replay transport).
