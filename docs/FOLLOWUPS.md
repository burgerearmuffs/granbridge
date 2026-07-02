# Follow-ups (post-Milestone 1)

From the final review of Milestone 1 (2026-05-21). None are M1 blockers; M1 shipped
with all five success criteria met and 44 tests passing. Listed roughly by value.

**Status audit 2026-07-02 (final-polish pass):** everything actionable below is now
resolved; the remaining unchecked items are deliberate deferrals, noted inline.

## Fixed in M1
- [x] **FrameAssembler state leak across reconnect** — partial-frame buffer + dedup
  state survived a disconnect. Added `FrameAssembler.reset()`, called in
  `ConnectionManager._connect_once`. (`protocol/frames.py`, `ble/connection.py`)

## Reliability / correctness
- [x] **`heartbeat` / `button` documented as RESERVED** (2026-07-02) — neither is
  emitted today (`OUT` decodes as a dart_hit MISS; the watchdog raises internally).
  Contract docstrings in `events/models.py` now say so explicitly.
- [x] **WS `sub.get()` cancellation** — clarifying comment added to
  `api/ws_server.py:_pump_out` (2026-07-02): drops at most one event, only for the
  already-disconnecting client. Benign by design.

## Headless logging (spec §8)
- [x] **JSON-logger sinks wired** — `logging_setup.py` provisions
  `logs/{raw_packets,decoded_packets,sessions,crashes}/`; `EventLogPlugin` persists
  decoded events (always-on in `serve`).

## Security hardening
- [x] **Origin guard** — `api/ws_server.py:_origin_policy`: loopback binds allow all
  (local-only); non-loopback binds enforce a CSWSH allowlist (served UI origins +
  extras + non-browser clients).
- [x] **Bounded subscriber queues** — `core/bus.py` `Subscription` caps at
  maxsize 1000 with drop-oldest (Step 3, 2026-05-22).

## Portable-app packaging prep
- [x] **`overrides_path` out of the package tree** — `config.py` now defaults to
  `%LOCALAPPDATA%\granbridge\segment_map.overrides.json` (same home as the history DB).
- [x] **Calibrate flow location documented** — the spec §4 `tools/calibrate.py`
  inventory entry is superseded: the flow lives at `protocol/calibrate_flow.py`,
  wired via `granbridge calibrate`. No thin wrapper needed.
- [ ] **Stream large replay sessions** (`cli.py replay`) — DEFERRED: reads the whole
  file; negligible at real session sizes. Revisit only if replay files grow past ~100 MB.

## Sub-project 2 (game engine) review

Fixed in SP2:
- [x] **M1** — live `attach()` path serialized `ring` as `"Ring.TRIPLE"`; now `event.ring.value`. Regression test added (`tests/game/test_attach_and_legs.py`).
- [x] **M2** — multi-leg starter now alternates by *starter* (tracked in `GameState.leg_starter_index`, snapshot-safe under undo), not by winner.
- [x] **L1** — bad `start_game` option values now emit `error{category:"command"}` instead of raising.
- [x] **L2** — engine exposes public `flush()`; `cli.py serve` uses it.
- [x] **L3** — `checkout._search` is `lru_cache`d (tiny domain: 169 scores × 3 darts);
  `mode_view` no longer rebuilds the ~33k-combo search.
- [x] **L4** — bounded bus queues (see Security hardening above).
- [x] **Sets** — `best_of_sets` implemented in the engine (and used by Medley).
