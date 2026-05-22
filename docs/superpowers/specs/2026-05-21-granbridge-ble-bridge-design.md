# GRANBRIDGE — Sub-project 1: "The Bridge" (Design Spec)

- **Date:** 2026-05-21
- **Status:** Approved design, pending spec review
- **Scope:** Milestone 1 vertical slice only. Other subsystems are explicitly out of scope (see §10).
- **Target platform:** Windows 11 · Python 3.12+ (dev machine has 3.14.2)
- **Target hardware:** GRANBOARD 3s (Dash compatibility via robust GATT enumeration, not hardcoding)

---

## 1. Goal & Success Criteria

**Goal:** Receive live dart-hit data from a GRANBOARD over BLE and expose it as structured
JSON events on Windows — end to end, runnable, testable without hardware.

**Milestone 1 is complete when:**

1. The app connects reliably to a GRANBOARD over BLE on Windows 11.
2. Dart hits are received as BLE notifications.
3. Hits decode into structured JSON (`dart_hit` events with `bed`, `score`, etc.).
4. Events stream over a local WebSocket server.
5. A simple browser overlay updates in real time (usable as an OBS browser source).

**Non-goals for this sub-project:** game logic, desktop UI, MQTT, plugin API, full OBS
scene suite, multiplayer, camera. The architecture leaves seams for them; it does not build them.

---

## 2. Protocol Facts (grounded from community RE)

These are seeded assumptions, validated live via the calibration tool (§6). Sources:
GranBoard-with-Autodarts, the aceslick911 GRANBOARD BLE HEX-codes gist, sobassy/gran-app.

- **Vendor service UUID:** `442f1570-8a00-9a28-cbe1-e1d4212d53eb`
- **Standard services present:** Battery `0000180f-...`, Device Info `0000180a-...`
- **Scan filter:** advertised name begins with `"GRAN"`.
- **Notification characteristic:** discovered by enumerating the vendor service and selecting
  the characteristic whose properties include `notify` (do **not** hardcode the UUID; the
  known value `442f1571-...` is recorded only as a hint/fallback).
- **Frame format:** ASCII text, each frame terminated by `@` (`0x40`). Example: `"2.5@"`.
- **Frame body:** `"<row>.<col>"` — a physical-segment matrix coordinate, **not** a score.
- **Special frames:** `"8.0@"` → single bull (25); `"4.0@"` → double bull (50);
  `"OUT@"` → miss / back button.
- **Possible header prefix:** some frames may carry a connection prefix (`"GB8;102"`); the
  frame assembler strips known prefixes defensively.
- **Ring taxonomy:** `SO` (single outer), `SI` (single inner), `D` (double), `T` (triple),
  `SBULL` (25), `DBULL` (50), `OUT` (miss). `SO`/`SI` both score as a single but are kept
  distinct for future heatmaps.

> The full `row.col → (ring, number)` table is seeded from community data and **completed/
> corrected live** via `granbridge calibrate`. Correctness of the seed table is *not* assumed.

---

## 3. Architecture & Data Flow

```
GRANBOARD ──BLE notify──> BleakTransport ──raw bytes──> FrameAssembler
                                                              │ complete ASCII frames
                                                        Decoder (segment_map)
                                                              │ Event objects (pydantic)
                                                          async EventBus
                                              ┌───────────────┼────────────────┐
                                         JSON logger     WebSocket server   (future sinks:
                                         (rotating)      ws://127.0.0.1:8787  MQTT, game engine,
                                                              │                plugins)
                                                     overlay/index.html (OBS browser source)
```

**Key seam:** the `EventBus` decouples production (BLE→decode) from consumption (log, WS,
future sinks). Adding MQTT or a game engine later = adding a subscriber, touching no decode code.

**Process model:** one async process for the MVP. `granbridge serve` runs the BLE connection
loop and the WebSocket server as concurrent asyncio tasks sharing one bus. The bridge is usable
headless (it logs structured JSON) with no frontend running.

---

## 4. Component Inventory

Each component states: *what it does / how it's used / what it depends on.*

| Module | Responsibility | Depends on |
|--------|----------------|------------|
| `ble/transport.py` | `Transport` Protocol (`scan`, `connect`, `subscribe`, `disconnect`, `write`); `BleakTransport` real impl; `FakeTransport`/`ReplayTransport` test impls | Bleak (real impl only) |
| `ble/connection.py` | Scan→connect→enumerate GATT→auto-subscribe notify char; reconnect w/ exponential backoff; heartbeat watchdog; resubscribe; stale-connection + adapter-reset recovery | `transport`, `core.bus` |
| `protocol/frames.py` | Reassemble byte stream into complete `@`-terminated frames; strip known prefixes; drop empty/duplicate frames (debounce window) | — |
| `protocol/segment_map.py` | Versioned `row.col → (ring, number)` lookup; load/save calibration overrides (JSON) | — |
| `protocol/decoder.py` | Frame string → `DartHit` / `Button` / `Unknown`; compute `bed` + `score` | `segment_map`, `events.models` |
| `events/models.py` | pydantic v2 event models; `to_json()`; schema export | pydantic |
| `events/schema/*.json` | JSON Schema for each event type (generated, committed) | — |
| `core/bus.py` | Async pub/sub `EventBus`; `publish(event)`, `subscribe() -> AsyncIterator` | — |
| `api/ws_server.py` | `websockets` server on `127.0.0.1:8787`; broadcast each event as JSON; send last-known snapshot to new clients | `core.bus`, `websockets` |
| `overlay/index.html` | Transparent demo overlay: last `bed` + running session total; reconnecting WS client | — |
| `logging_setup.py` | structlog config; rotating file handlers for `logs/{raw_packets,decoded_packets,sessions,crashes}` | structlog |
| `config.py` | pydantic-settings: WS host/port, board name prefix, backoff params, log dir | pydantic-settings |
| `cli.py` | Typer CLI: `scan`, `serve`, `calibrate`, `replay` | all above |
| `tools/parse_hci.py` | Parse Android `btsnoop_hci.log`; emit ATT/GATT writes+notifications as readable rows | — |
| `tools/diff_packets.py` | Diff two captured frame sets / sessions; highlight repeated vs unique frames | — |
| `tools/identify_hits.py` | Heuristic: cluster captured frames, flag likely hit vs heartbeat vs battery | — |
| `tools/calibrate.py` | Interactive: prompt "throw at T20", capture frame, write `segment_map` override | `ble.connection`, `segment_map` |

---

## 5. Event Contract (versioned)

All events share `schema_version`, `type`, `timestamp` (ISO-8601 UTC, ms precision).

**`dart_hit`**
```json
{
  "schema_version": "1.0",
  "type": "dart_hit",
  "timestamp": "2026-05-21T18:30:22.123Z",
  "raw": "12.3@",
  "ring": "T",
  "segment": 20,
  "multiplier": 3,
  "bed": "T20",
  "score": 60
}
```
- Miss/back → `ring:"OUT"`, `segment:null`, `multiplier:0`, `bed:"MISS"`, `score:0`.
- Single bull → `ring:"SBULL"`, `segment:25`, `multiplier:1`, `bed:"BULL"`, `score:25`.
- Double bull → `ring:"DBULL"`, `segment:25`, `multiplier:2`, `bed:"DBULL"`, `score:50`.

**`connection_state`** — `{ ..., "state": "scanning|connecting|connected|reconnecting|disconnected", "device": "<name|null>", "rssi": <int|null> }`

**`button`** — non-scoring board buttons distinct from OUT, if discovered: `{ ..., "raw": "...", "name": "<string>" }`

**`heartbeat`** — `{ ..., "source": "board|watchdog" }`

**`error`** — `{ ..., "category": "ble|decode|transport", "message": "<string>", "recoverable": <bool> }`

**Unknown frames** are never dropped silently: emitted as `dart_hit` only on a confident map
hit; otherwise logged raw and emitted as `error` (`category:"decode"`, `recoverable:true`) so
calibration gaps are visible.

---

## 6. Calibration Workflow

`granbridge calibrate` connects to the board, then for each canonical bed in a guided sequence
(20 segments × {S,D,T} + bulls) prompts the user to throw, captures the next confident frame,
and records `raw → (ring, number)` into `segment_map.overrides.json`. Overrides take precedence
over the seeded table. The user can run a partial calibration (e.g. only the beds that decode
wrong) — it's incremental, not all-or-nothing.

---

## 7. Reliability Requirements

- **Reconnect:** exponential backoff (configurable base/cap, jitter) on any disconnect.
- **Watchdog:** if no frame (incl. board heartbeat) within `heartbeat_timeout`, force reconnect.
- **Resubscribe:** re-enumerate + re-subscribe notify char after every reconnect.
- **Board sleep:** treated as a normal disconnect → backoff reconnect; no crash, no manual restart.
- **Adapter reset / transient drop:** caught at transport layer; surfaced as `connection_state`
  + `error(recoverable:true)`; loop continues.
- **Duplicate notifications:** debounce identical frames within a short window (configurable).
- **Frame ordering / partial frames:** handled by `FrameAssembler` buffering until `@`.

---

## 8. Logging & Replay

- structlog, JSON renderer to rotating files:
  - `logs/raw_packets/` — every raw notification (hex + decoded ASCII + ts).
  - `logs/decoded_packets/` — every emitted event.
  - `logs/sessions/` — one append-only frame log per `serve` run (replay source).
  - `logs/crashes/` — uncaught-exception dumps with context.
- **Replay:** `granbridge replay logs/sessions/<file>` feeds recorded frames through
  `ReplayTransport` at original (or accelerated) timing — identical downstream code path,
  no hardware. Replay is also the backbone of regression tests.

---

## 9. Testing Strategy

- **Framework:** pytest; 100% CI-safe (no BLE hardware, no network egress).
- **`FakeTransport`:** drives frames programmatically + injects faults (disconnect, garbage,
  partial frame, duplicate) to exercise reliability paths.
- **Decoder tests:** deterministic table over recorded/synthetic frames incl. bulls, OUT, unknown.
- **FrameAssembler tests:** split/partial/prefix/duplicate cases.
- **Reconnect tests:** assert backoff schedule + resubscribe via fault-injecting fake.
- **Schema tests:** every emitted event validates against its committed JSON Schema.
- **Replay regression:** a checked-in sample session replays to a known event sequence.

---

## 10. Out of Scope (future sub-projects)

Game engine (X01/Cricket/checkouts) · Tauri/React desktop UI · MQTT bridge · plugin API ·
full OBS scene suite · Discord/Hue/WLED/Home Assistant integrations · online multiplayer ·
camera validation · AI commentary. **Seams provided now:** `EventBus` (drop-in subscribers),
versioned event schema, `Transport` interface, model-agnostic GATT enumeration.

---

## 11. Repository Layout

```
granbridge/
├── pyproject.toml
├── README.md
├── .gitignore
├── docs/
│   ├── superpowers/specs/2026-05-21-granbridge-ble-bridge-design.md
│   ├── reverse-engineering.md      # HCI capture + calibration workflow
│   └── windows-setup.md            # Windows 11 BLE setup + onboarding
├── src/granbridge/
│   ├── __init__.py
│   ├── __main__.py                 # python -m granbridge -> cli
│   ├── cli.py
│   ├── config.py
│   ├── logging_setup.py
│   ├── core/bus.py
│   ├── ble/{transport.py,connection.py}
│   ├── protocol/{frames.py,segment_map.py,decoder.py}
│   ├── events/{models.py,schema/}
│   ├── api/ws_server.py
│   └── overlay/index.html
├── tools/{parse_hci.py,diff_packets.py,identify_hits.py,calibrate.py}
├── logs/{raw_packets,decoded_packets,sessions,crashes}/  # .gitkeep, gitignored content
└── tests/
```

---

## 12. Stack

Python 3.12+ · asyncio · **Bleak** (BLE) · **websockets** (event feed) · **pydantic v2** +
**pydantic-settings** · **structlog** · **Typer** (CLI) · **pytest**. FastAPI intentionally
deferred to a future HTTP/control-plane layer; raw `websockets` is leaner and lower-latency for
a pure push feed.

---

## 13. Code Quality Standards

Type hints everywhere · pydantic models for all events/config · structured logging ·
async-first · dependency injection via the `Transport` interface · small single-purpose modules ·
docstrings on public functions. Reliability first, latency second, UX third, polish later.
