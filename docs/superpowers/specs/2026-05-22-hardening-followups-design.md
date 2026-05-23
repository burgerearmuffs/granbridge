# Hardening Follow-ups — Design

> Two long-standing follow-ups (Step-3 backlog) ahead of cutting a fresh release:
> a WebSocket **Origin guard** for non-loopback binds, and moving writable paths
> (`overrides_path`, `log_dir`) to **%LOCALAPPDATA%\granbridge** so the packaged app behaves.
> Brainstormed/pre-approved 2026-05-22. Small, contained, Python-only.

## Item 1 — WebSocket Origin guard (CSWSH protection)
**Problem:** the bridge WS (`api/ws_server.py`) currently accepts any connection. When bound to
loopback (`127.0.0.1`, the default) that is safe — only local processes can reach it. But if a user
binds it to a non-loopback host to play over a LAN/the internet, a malicious web page in the user's
browser could open a WebSocket to it (cross-site WebSocket hijacking) and read game state / inject
commands.

**Design:** use the `websockets` library's built-in `origins=` parameter on `serve()` (websockets
16.0, confirmed installed).
- **Loopback bind** (`host in {"127.0.0.1","localhost","::1",""}`): pass `origins=None` → allow all
  (current behavior; local-only is safe).
- **Non-loopback bind:** pass `origins=[<allowed>, None]` — the allowlist is the served UI origins
  (`http://{host}:{http_port}`, `http://localhost:{http_port}`, `http://127.0.0.1:{http_port}`) plus
  any `settings.allowed_origins`, plus `None` (a missing Origin = a non-browser client; browsers
  always send Origin, so the CSWSH guard still holds while native tooling isn't broken).
- A pure helper makes it testable: `_origin_policy(host, http_port, extra) -> Optional[list[str | None]]`
  (returns `None` for loopback, else the allowlist). `WebSocketServer.start()` passes its result to
  `serve(..., origins=...)`.

**Wiring:** `WebSocketServer.__init__` gains `http_port: int` and `allowed_origins: list[str]`
parameters; `cli.py serve` passes `settings.http_port` and `settings.allowed_origins`. `config.py`
gains `allowed_origins: list[str] = []`.

## Item 2 — Writable paths → %LOCALAPPDATA%\granbridge
**Problem:** `config.py` has `overrides_path = Path("src/granbridge/protocol/segment_map.overrides.json")`
(repo-relative — absent in a packaged install; calibration would write to the wrong place / fail) and
`log_dir = Path("logs")` (relative to cwd). `history_db` already uses `%LOCALAPPDATA%\granbridge`.

**Design:** point both at the same AppData base as `history_db`:
- `overrides_path = Path(os.environ.get("LOCALAPPDATA", ".")) / "granbridge" / "segment_map.overrides.json"`
- `log_dir = Path(os.environ.get("LOCALAPPDATA", ".")) / "granbridge" / "logs"`

**Safe:** the board-validated segment map is baked into `segment_map.py` (`_NUMBERS`/`_SEED`); the
overrides JSON is optional per-board calibration that is **not tracked and not on disk**, so moving its
path changes nothing for existing installs and lets the packaged app calibrate to a writable location.
Directories are created on demand by the existing code (`HistoryStore` mkdirs; `configure_logging`
and the event-log sink mkdir their dirs).

## Components
- `src/granbridge/config.py`: add `allowed_origins: list[str] = []`; repoint `overrides_path` + `log_dir` to AppData.
- `src/granbridge/api/ws_server.py`: `_origin_policy(host, http_port, extra)` helper; `__init__` gains
  `http_port`/`allowed_origins`; `start()` passes `origins=_origin_policy(...)` to `serve`.
- `src/granbridge/cli.py`: `serve` constructs `WebSocketServer(bus, ws_host, ws_port, command_handler=…,
  http_port=settings.http_port, allowed_origins=settings.allowed_origins)`. (The `replay` command also
  constructs a `WebSocketServer` without those — keep them optional with safe defaults so `replay` is
  unaffected.)

## Testing
- **`tests/api/` (origin policy, pure):** `_origin_policy("127.0.0.1", 8080, [])` is `None`;
  `_origin_policy("0.0.0.0", 8080, [])` contains `http://0.0.0.0:8080`, `http://localhost:8080`,
  `http://127.0.0.1:8080`, and `None`; extras are included; `"localhost"`/`"::1"` are treated as loopback.
- **Config (`tests/test_config.py` or similar):** `Settings().overrides_path` and `.log_dir` end with the
  `granbridge` AppData segment (assert the path parts contain `"granbridge"`); `allowed_origins == []`.
- **Smoke:** constructing `WebSocketServer(..., http_port=8080, allowed_origins=[])` and calling
  `start()`/`stop()` on a non-loopback host works (origins accepted by `serve`); existing ws_server
  tests stay green. Keep the `replay` path (no http_port/allowed_origins passed) working via defaults.
- Full Python suite green.

## Build order (for writing-plans)
1. Config: `allowed_origins` + AppData paths (+ config tests).
2. WS server: `_origin_policy` + wiring + cli pass-through (+ origin-policy tests + smoke).
Then full Python suite green.

## Out of scope (deferred, as before)
- Raw-frame log sink (BLE-adjacent). TLS/wss for the bridge WS (separate effort; the broker handles
  the internet path). Auth on the bridge WS (the Origin guard is the MVP CSWSH mitigation).
