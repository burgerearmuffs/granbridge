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

## Sub-project 2 (game engine) review

Fixed in SP2:
- [x] **M1** — live `attach()` path serialized `ring` as `"Ring.TRIPLE"`; now `event.ring.value`. Regression test added (`tests/game/test_attach_and_legs.py`).
- [x] **M2** — multi-leg starter now alternates by *starter* (tracked in `GameState.leg_starter_index`, snapshot-safe under undo), not by winner.
- [x] **L1** — bad `start_game` option values now emit `error{category:"command"}` instead of raising.

Open follow-ups:
- [ ] **L2** — `cli.py serve` reaches into engine private `_flush()` + per-payload local import; expose a public `flush()` and hoist the import.
- [ ] **L3** — `checkout._search` runs a ~33k-combo 3-dart loop and rebuilds tables on every `mode_view`; memoize or widen the preferred table for live finishes.
- [ ] **L4** — (same as the bus-queue bound above) a stalled WS client's subscription queue is unbounded.
- [ ] **Sets** — X01/Cricket match structure tracks legs (`best_of_legs`); `sets` is carried in state but not yet won/advanced. Wire sets when needed.

## Resolved in Step 3 (2026-05-22 run 2)
- [x] **L4 / bounded bus queues** — `Subscription` now caps at maxsize (1000) with drop-oldest.
- [x] **X01 sets** — `best_of_sets` match structure implemented in the engine (backward-compatible).
- [x] **§8 decoded log sink** — `EventLogPlugin` writes `logs/decoded_packets/events.jsonl` (always-on in `serve`).
- [x] **AppData path (history)** — match-history DB defaults under `%LOCALAPPDATA%\granbridge`.

## Still open after Step 3 (deferred, with reasons)
- [ ] **Real app icons** — replace placeholder green squares; needs image tooling (sharp/png-to-ico) + a Tauri rebuild. Not done because run 2 didn't rebuild the installer.
- [ ] **WS origin-guard** — only matters before binding off `127.0.0.1` (still localhost-only).
- [ ] **raw-frame log sink** (`logs/raw_packets/`) — BLE-adjacent; skipped to respect the "don't touch BLE during calibration" guardrail. Wire after hardware validation.
- [ ] **`overrides_path`→AppData** — skipped during run 2 because it's where live `calibrate` writes; move it after calibration is settled.
- [ ] **L2/L3** — `cli` private `_flush`/import hygiene; `checkout._search` memoization.

## QA — bugs found testing v0.1.3 (2026-05-25)
Reported by the user during v0.1.3 release testing; not yet fixed (noted for a later pass).

- [ ] **Local mode: manual scoring buttons do nothing.** The on-screen scoring controls
  (`ui/src/components/Controls.tsx`) have no effect in Local mode. Needs repro; suspects: the
  engine remote-role gate may still be armed (MP-3 deliberately keeps it armed on transient unmount
  via `RemoteMatch.stop(false)`) and filtering local input, or the manual-score command isn't wired
  when no board is connected. Check that `set_remote_role` is null while in Local mode.
- [ ] **Leaderboard can't connect to the stats server.** `Leaderboard.tsx` → `fetchLeaderboard`
  → `brokerHttpBase(readBrokerUrl())`. Two compounding causes: (a) the broker URL defaults to
  `ws://127.0.0.1:8788`, where no stats server is listening (see the default-URL item below); and
  (b) server-side stats isn't deployed/enabled on the live broker yet (the darts.aventador.io deploy
  + `data` volume is still pending). Likely resolved by the default-URL fix **plus** enabling stats
  on the broker.
- [ ] **History errors in the installable package** (works in dev). The DB path is fine
  (`%LOCALAPPDATA%\granbridge\history.db`, `config.py:28`, writable), so suspect a frozen-path
  resource resolution (`static_dirs()`) or an unhandled error in a `/api/history/*` route under
  PyInstaller. Needs the actual error text from the packaged build to pin it down.
- [ ] **Multiplayer broker field should default to `wss://darts.aventador.io/` in all builds.**
  `ui/src/multiplayer/store.ts:33` `readBrokerUrl()` falls back to `ws://127.0.0.1:8788`
  (or `VITE_BROKER_URL`). Change the hardcoded fallback (and/or bake `VITE_BROKER_URL` at build time)
  to `wss://darts.aventador.io/`. One-liner; also fixes half of the leaderboard issue above.
