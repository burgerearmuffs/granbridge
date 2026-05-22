# Medley Game Mode — Design

> A "quick parity" match format: a sequence of different games played as successive legs, best-of-N.
> Brainstormed 2026-05-22 (the deferred half of "Count-Up, Medley"). **No engine changes** — Medley is
> a pure additive `GameMode` that delegates to the existing sub-modes and rides the engine's existing
> best-of-legs machinery.

## What Medley is
A match made of a **sequence** of games (default `["x01", "cricket", "count_up"]`), each played as one
**leg** with a different mode. The engine's existing best-of-legs logic runs the match: with
`best_of_legs = len(sequence)`, the **first player to win ⌈N/2⌉ legs wins the match** (so a best-of-3
medley can end after 2 legs). Each leg uses the next mode in the sequence.

## Scope
- **In:** a new `medley` mode (`MedleyMode`) that delegates per-leg to existing sub-modes; a
  `MedleyBoard` that shows a medley header + delegates to the existing sub-board; Medley in the local
  Setup form and the Multiplayer start-match panel (using the **default** sequence).
- **Out / deferred:** a custom sequence-picker UI (the mode *supports* `options.sequence`, but the MVP
  Setup uses the default sequence); per-sub-mode option overrides inside a medley (sub-modes use their
  defaults — 501 X01, standard Cricket, 8-round Count-Up).
- **No engine changes.** Verified against `engine.py`: the engine re-calls `mode.on_start` on each new
  leg (the advance hook) and re-instantiates the mode from the registry on undo (so mode state must
  live in `mode_view`, which Medley honors).

## Why no engine change works (key facts from `engine.py`)
- `_on_leg_won(pid)`: increments `legs[pid]`; when `legs[pid] >= best_of_legs//2 + 1` the set/match is
  won (with `best_of_sets=1`, the match ends). Otherwise it alternates the starter and calls
  `self._mode.on_start(state, state.options)` for the next leg. → **Medley advances its sequence inside
  `on_start`.**
- `_undo_last`: restores the snapshot and does `self._mode = _REGISTRY[self.state.mode]()` — a FRESH
  mode instance. → **Medley must be instance-stateless; all sequence state lives in `mode_view`.**
- All leg-ending sub-modes (X01, Cricket, Around-the-Clock, Count-Up) are instance-stateless, fully set
  `mode_view` in `on_start`, and return `DartResult(leg_won=True, winner=pid)` on a win — confirmed by
  reading each. (Free-play never ends a leg and Medley would recurse, so both are excluded from sequences.)

## Architecture

### `MedleyMode` (`src/granbridge/game/modes/medley.py`, new)
- `name = "medley"`.
- A private sub-mode registry (NOT the engine's, to avoid a circular import):
  `_SUB_MODES = {"x01": X01Mode, "cricket": CricketMode, "around_the_clock": AroundTheClockMode, "count_up": CountUpMode}`.
- `DEFAULT_SEQUENCE = ["x01", "cricket", "count_up"]`.
- `on_start(state, options)`:
  - Read `prior = state.mode_view.get("medley")` BEFORE the sub-mode overwrites `mode_view`.
  - If `prior is None` (first leg, called from `_start`): `sequence = options.get("sequence") or DEFAULT_SEQUENCE`; validate every entry is in `_SUB_MODES` (else raise `ValueError(f"unknown medley sub-mode {m!r}")` — `_start` catches it into an error event); `index = 0`; and set
    `state.options["best_of_legs"] = len(sequence)`, `state.options["best_of_sets"] = 1`.
  - Else (next leg, called from `_on_leg_won`): `sequence = prior["sequence"]`; `index = prior["index"] + 1`.
  - `current = sequence[index]`; instantiate `sub = _SUB_MODES[current]()`; call `sub.on_start(state, options)` (this sets the sub-mode's top-level `mode_view` keys, overwriting `mode_view`).
  - THEN add the meta key: `state.mode_view["medley"] = {"sequence": sequence, "index": index, "current": current}`.
- `apply_dart(state, dart)`: read `current = state.mode_view["medley"]["current"]`; `sub = _SUB_MODES[current]()`; `return sub.apply_dart(state, dart)`. (The sub-mode reads/writes its top-level `mode_view` keys; the returned `DartResult` — including `leg_won`/`winner` — propagates unchanged so the engine handles best-of-legs and advances to the next leg via `on_start`.)
- `mode_view(state)`: `return dict(state.mode_view)` (sub-mode keys + `medley` meta). Note: do NOT call the sub-mode's `mode_view` (e.g. X01's `checkout_hint`) for MVP — the sub-mode already wrote its keys in `apply_dart`/`on_start`; returning the dict is sufficient and matches how `_emit_state` works (it calls `self._mode.mode_view(state)`).
  - **Refinement:** to preserve sub-mode niceties like the X01 checkout hint, `mode_view` MAY delegate: `view = _SUB_MODES[current]().mode_view(state); view["medley"] = state.mode_view["medley"]; return view`. This keeps `medley` meta while letting the sub-mode compute its view. Use this delegating form.

### `MedleyBoard` (`ui/src/components/boards/MedleyBoard.tsx`, new)
- Reads `state.mode_view?.medley` → `{ sequence, index, current }`.
- Renders a header: `Game {index+1} / {sequence.length} — {label(current)}` plus the legs tally
  (reuse `state.legs`), then DELEGATES to the existing sub-board chosen by `current`
  (`X01Board`/`CricketBoard`/`AtcBoard`/`CountUpBoard`), passing the same `state` (the sub-board reads
  its top-level `mode_view` keys, which are present). Falls back to a small notice if `medley` is absent.
- `ui/src/views/LiveGame.tsx`: add `case "medley": return <MedleyBoard state={state} />;`.

### Registration + commands
- `engine.py`: import `MedleyMode`; add `"medley": MedleyMode` to `_REGISTRY`. (The ONLY engine-file change — a registry line + import, not logic.)
- No `commands.py` change (`sequence` rides in `options`; mode is a string).

### UI entry points
- `Setup.tsx`: add `<option value="medley">Medley</option>`; for MVP no sequence picker — submit
  `options = {}` for medley (the mode applies `DEFAULT_SEQUENCE`). A small static note can list the
  default sequence.
- `Multiplayer.tsx`: add `<option value="medley">Medley</option>` to the start-match select (default sequence).

## Testing
- **Python (`tests/game/test_medley.py`)**, driving the engine via `StartGame`/`on_dart`:
  - default sequence applied; `mode_view["medley"]` has `sequence`/`index:0`/`current:"x01"` at start;
    `best_of_legs` set to 3 in options.
  - leg 1 plays as x01: a 501 checkout (`_throw` to 0 via doubles) wins leg 1; `mode_view["medley"]["current"]`
    becomes `"cricket"` and `index` becomes 1 (sequence advanced via the engine's on_start hook).
  - winning ⌈N/2⌉ legs ends the match: with default 3, a player who wins legs 1 and 2 → `status=finished`,
    `winner` set after 2 legs (3rd not played).
  - a custom sequence (e.g. `["count_up", "x01"]`, `best_of_legs` becomes 2): leg 1 is count_up; after it,
    `current` becomes `"x01"`.
  - unknown sub-mode in `sequence` (e.g. `["x01","nope"]`) → start aborts with a `command` error event
    (no game in progress).
  - undo across a leg boundary: win leg 1 (advances to cricket), then `Undo` → `mode_view["medley"]["current"]`
    is back to `"x01"` and the mode functions (a subsequent dart scores in x01).
  - `free_play`/`medley` rejected if placed in a sequence (unknown-to-`_SUB_MODES` → error).
- **UI (`MedleyBoard.test.tsx`)**: given a `mode_view` with `medley:{sequence,index,current:"x01", ...}` plus
  x01 keys (`scores`), renders the header "Game 1 / 3" + the X01 sub-board (a score shows); switching
  `current:"cricket"` renders the Cricket sub-board. **Setup.test.tsx / build**: Medley option present.
- Full Python + UI suites + `npm --prefix ui run build` stay green.

## Edge cases / decisions
- **Best-of-N, can end early:** reuses the engine's `best_of_legs` (= sequence length). Odd default (3) →
  no ties. Even-length custom sequences: the engine still ends at the first to ⌈N/2⌉ (standard).
- **Sub-mode options:** sub-modes use defaults inside a medley (501 X01, 8-round Count-Up). Per-sub-mode
  option overrides are deferred.
- **Excluded sub-modes:** `free_play` (never ends a leg → would hang) and `medley` (recursion) are not in
  `_SUB_MODES`, so a sequence containing them errors at start.
- **Undo:** safe — sequence state lives in `mode_view` (snapshotted); `MedleyMode` is instance-stateless,
  so the engine's re-instantiation on undo is harmless.
- **Misses / next_player:** delegated to the sub-mode like any dart/command (no special handling).

## Build order (for writing-plans)
1. `MedleyMode` + registration (+ Python tests via the engine: advance, best-of-N end, custom sequence,
   unknown-mode error, undo-across-leg).
2. `MedleyBoard` (header + sub-board delegation) + `LiveGame` routing (+ board test).
3. `Setup` Medley option + `Multiplayer` start-panel option (+ Setup test).
4. Docs: BUILD-LOG entry.
Then full suites + build green.
