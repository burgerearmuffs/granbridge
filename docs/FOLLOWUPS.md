# Follow-ups (post-Milestone 1)

From the final review of Milestone 1 (2026-05-21). None are M1 blockers; M1 shipped
with all five success criteria met and 44 tests passing. Listed roughly by value.

## Fixed in M1
- [x] **FrameAssembler state leak across reconnect** — partial-frame buffer + dedup
  state survived a disconnect. Added `FrameAssembler.reset()`, called in
  `ConnectionManager._connect_once`. (`protocol/frames.py`, `ble/connection.py`)

## Reliability / correctness
- [ ] **Emit `heartbeat` / `button` events, or document as reserved.** The watchdog
  raises an internal `RuntimeError` (`ble/connection.py`) but never publishes a
  `Heartbeat(source="watchdog")`; `OUT` decodes to a `dart_hit` MISS rather than a
  `ButtonEvent`. Spec §5/§7 reserve these "if discovered". Either wire them or note
  them reserved in the contract.
- [ ] **WS `sub.get()` cancellation can drop one event on client disconnect**
  (`api/ws_server.py`). Benign (only affects an already-closing client); add a clarifying
  comment.

## Headless logging (spec §8)
- [ ] **Wire JSON-logger bus subscribers** for `logs/raw_packets/`,
  `logs/decoded_packets/`, and `logs/crashes/`. Today only `logs/sessions/` has a
  rotating handler and nothing subscribes to the bus to persist events headlessly.
  (`logging_setup.py`, `cli.py serve`)

## Security hardening (only matters before a non-loopback bind)
- [ ] **Origin/host guard + auth** before ever binding off `127.0.0.1`. `GRANBRIDGE_WS_HOST`
  can be set to `0.0.0.0` today with no `Origin` check or auth.
- [ ] **Bound the subscriber queues** (`core/bus.py` uses unbounded `asyncio.Queue`).
  Add `maxsize` + a drop-oldest policy so a stalled WS client cannot grow memory.

## Portable-app packaging prep
- [ ] **Move `overrides_path` out of the package tree** (`config.py` defaults to
  `src/granbridge/protocol/segment_map.overrides.json`, relative to CWD) toward an
  AppData/user-config location ahead of PyInstaller packaging.
- [ ] **Add `tools/calibrate.py` thin wrapper** (spec §4 inventory) or update the spec —
  the flow currently lives at `protocol/calibrate_flow.py`, wired via the CLI.
- [ ] **Stream large replay sessions** instead of reading the whole file
  (`cli.py replay`). Negligible for sample sizes.
