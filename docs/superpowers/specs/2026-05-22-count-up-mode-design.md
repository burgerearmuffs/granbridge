# Count-Up Game Mode — Design

> A "quick parity" game mode (matches the official app's Count-Up). Brainstormed 2026-05-22.
> Builds on the existing `GameMode` plug-in contract (`src/granbridge/game/modes/`), the engine's
> leg/winner machinery, and the UI's per-mode board switch (`LiveGame.tsx`).

## Scope
- **In:** a new `count_up` game mode (Python engine), one small backward-compatible engine change so
  the winner can be a player other than the one who threw the final dart, a `CountUpBoard` UI, and the
  Count-Up option in the local Setup form + the Multiplayer start-match panel.
- **Out / deferred:** **Medley** (a match made of a *sequence* of different games) — a separate, larger
  sub-project that orchestrates multiple games and depends on the full mode set; it gets its own spec.
- **Decomposition note:** the BUILD-LOG groups "Count-Up, Medley" as quick parity modes. Count-Up is a
  self-contained new mode; Medley is match orchestration. They are independent — Count-Up ships first.

## What Count-Up is
Each player throws a fixed number of **rounds** (default **8**), 3 darts per round. Every dart's points
accumulate (singles/doubles/trebles as normal; **bull = 25, double-bull = 50**). There is **no
double-in/out and no bust** — every dart counts. After the last player finishes the last round, the
**highest cumulative total wins**. Works for 1 player (solo practice) or many.

## Engine contract today (relevant facts)
- `GameMode.apply_dart(state, dart) -> DartResult{points, busted, leg_won, winner}`. The engine appends
  the dart to `state.visit` AFTER `apply_dart`, then advances to the next player when `len(visit) >= 3`.
- On `leg_won=True` the engine calls `_on_leg_won(pid)` where **`pid` is the active player** — it does
  NOT currently read `DartResult.winner`. With `best_of_legs`/`best_of_sets` defaulting to 1, a single
  `leg_won` ends the match: `status=FINISHED`, `state.winner=pid`, `GameWon` emitted.
- All existing modes (X01, Around-the-Clock, Cricket) set `winner=pid` on `leg_won`, so the active
  player IS the winner for them.
- `mode_view` is deep-copied into snapshots, so undo/correct restore mode state for free.

## Design

### 1. Engine change (one line, backward-compatible)
In `GameEngine.on_dart`, the `leg_won` branch becomes:
```python
if result.leg_won:
    self._on_leg_won(result.winner or pid)
    return
```
For every existing mode `result.winner == pid`, so behavior is unchanged. Count-Up will set
`winner = <highest total>`, which may differ from the active player — this makes that work.

### 2. `CountUpMode` (`src/granbridge/game/modes/count_up.py`, new)
- `name = "count_up"`.
- `on_start(state, options)`:
  - `rounds = max(1, int(options.get("rounds", 8)))`.
  - `state.options = {**state.options, **options}`.
  - `state.mode_view = {"total": {pid: 0}, "hits": {pid: {}}, "rounds": rounds, "current_round": 1}`.
- `apply_dart(state, dart) -> DartResult`:
  - `pid = state.active_player_id`; `total[pid] += dart.score`; record `hits[pid][dart.bed] += 1`.
  - Detect end-of-round: a round completes when the active player throws their 3rd dart AND they are
    the last player. At `apply_dart` time, `state.visit` holds the darts thrown so far this turn, so:
    - `is_last_dart = len(state.visit) == 2` (this is the 3rd dart).
    - `is_last_player = state.active_index == len(state.players) - 1`.
  - If `is_last_dart and is_last_player` (a round just finished):
    - If `current_round >= rounds` → game over: compute `winner` = the player id with the highest
      `total` (ties broken by player order — the first player reaching the max). Return
      `DartResult(points=dart.score, leg_won=True, winner=winner)`.
    - Else increment `current_round` (the displayed round advances) and return `DartResult(points=dart.score)`.
  - Otherwise return `DartResult(points=dart.score)`.
- `mode_view(state)`: `return dict(state.mode_view)` (total, hits, rounds, current_round).
- No `checkout_hint`.

**Winner computation helper (pure, inside the mode):** given `total: dict[str,int]` and the ordered
`state.players`, return the first player id whose total equals `max(total.values())`. Documented:
**ties go to the earlier player in turn order** (MVP — no tie-break round).

### 3. Registration
- `engine.py`: import `CountUpMode`; add `"count_up": CountUpMode` to `_REGISTRY`.
- No `commands.py` change (mode is a free-form string; `rounds` rides in `options`).

### 4. UI
- **`ui/src/components/boards/CountUpBoard.tsx`** (new): per-player card (name + big total), highlight the
  current leader (highest total) and the active player; a header "Round {current_round} / {rounds}".
  Mirrors `FreePlayBoard`'s shape (reads `state.mode_view.total` / `current_round` / `rounds`).
- **`ui/src/views/LiveGame.tsx`**: add `case "count_up": return <CountUpBoard state={state} />;`.
- **`ui/src/views/Setup.tsx`**: add `<option value="count_up">Count-Up</option>`; a Count-Up options
  block (a `rounds` number input, default 8) shown when `mode === "count_up"`; include `{ rounds }` in
  the submitted options for that mode.
- **`ui/src/views/Multiplayer.tsx`**: add `<option value="count_up">Count-Up</option>` to the start-match
  mode select. `handleStartMatch` already sends `{}` options for non-x01 modes → Count-Up uses the
  default 8 rounds in remote play (per-match rounds config in remote is out of scope).
- `types.ts`: no change (mode is `string`, `mode_view` is `Record<string, any>`).

## Testing
- **Python (`tests/game/test_count_up.py`):** drive the engine via `StartGame`/`on_dart`:
  - scoring accumulates across darts; bull=25, dbull=50 via `Dart.from_bed`.
  - `current_round` advances after each player completes 3 darts; ends after exactly `rounds` rounds.
  - game finishes with `status=FINISHED` and `winner` = the highest total (2-player: make p2 outscore p1
    and confirm p2 wins even though p1 threw the final dart of the round if applicable — exercises the
    engine `result.winner` path).
  - tie → earlier player wins (documented behavior).
  - solo (1 player) ends after `rounds` rounds with that player as winner.
  - `rounds` option respected (e.g. `rounds=2` ends quickly); default is 8 when omitted.
- **Python (`tests/game/test_engine.py` or test_count_up):** an explicit assertion that a mode returning
  `leg_won=True, winner=<non-active>` makes the engine declare that player the winner (the engine change).
- **UI (`CountUpBoard.test.tsx`):** renders each player's total and the "Round x / y" header from a
  `mode_view`; leader highlight present. **Setup.test.tsx:** the Count-Up `<option>` exists and selecting
  it reveals the rounds input. (Multiplayer mode-option addition is covered by build/typecheck.)
- Full Python + UI suites + `npm --prefix ui run build` stay green.

## Edge cases / decisions
- **Ties:** earlier player in turn order wins (documented; no tie-break round in MVP).
- **Undo/correct:** handled automatically by the engine's `mode_view` snapshot — round counter and totals
  revert with the snapshot; no special handling.
- **Misses:** `record_miss` routes a `MISS` dart (score 0) through `apply_dart` like any dart — counts as
  a thrown dart, adds 0, advances the round normally. No special case.
- **No bust / no checkout:** every dart scores; `busted` is never returned.
- **Full 3-dart turns assumed:** the round counter and end-detection key off the active player's 3rd
  dart (`len(visit) == 2`), matching how Count-Up is actually played. Advancing early with the
  `next_player` command mid-round is not a supported Count-Up action (it would desync the round
  counter); the standard flow throws all 3 darts each round. Documented limitation for MVP.

## Build order (for writing-plans)
1. Engine: honor `result.winner` (+ a focused test).
2. `CountUpMode` + registration (+ Python mode tests via the engine).
3. `CountUpBoard` + `LiveGame` routing (+ board test).
4. `Setup` Count-Up option + rounds input (+ test); `Multiplayer` start-panel option.
5. Docs: BUILD-LOG entry.
Then full suites + build green.
