# GRANBRIDGE — Sub-project 2: "Game Engine" (Design Spec)

- **Date:** 2026-05-21
- **Status:** Approved design, pending spec review
- **Depends on:** Sub-project 1 ("The Bridge") — merged to `master`. Reuses `EventBus`,
  the `dart_hit` event contract, and the WebSocket server.
- **Target platform:** Windows 11 · Python 3.12+ (dev 3.14.2)

---

## 1. Goal & Success Criteria

Turn the raw `dart_hit` event stream into **playable darts games**.

**Done when:**
1. A client can **start a game over the WebSocket** (`start_game` command) for X01, Cricket,
   Around-the-Clock, or Free-play.
2. Darts (live or replayed) are scored correctly per the active mode, with a correct
   **turn/visit model** (3 darts/visit, auto-advance, manual `next_player`, `record_miss`).
3. The engine emits an authoritative **`game_state`** event on every change, plus
   transition events (`bust`, `leg_won`, `game_won`), to the overlay.
4. **Undo** and **correct-last** work in every mode (misreads/bounce-outs are routine).
5. X01 shows **checkout suggestions**; Cricket tracks marks/points and detects the
   standard win; practice modes track progress/stats.
6. Everything is **hardware-free testable** (deterministic dart sequences / `ReplayTransport`).

**Non-goals:** rich Tauri UI, persistent match history/DB, online multiplayer, AI commentary
(later sub-projects). The command channel + `game_state` contract are the seams for those.

---

## 2. Key Architectural Decision: Snapshot-based Undo

Before applying each dart or command, the engine pushes a **deep copy** of game state onto a
bounded undo stack. `undo` = pop + restore. A **bust** = restore to the start-of-visit
snapshot. `correct_last` = undo, then re-apply with the corrected bed.

Chosen over event-sourcing (more machinery than needed) and per-mode manual revert (4 modes
each reimplementing reverse-operations = bug surface). Snapshot-undo makes undo, correction,
and bust **universal and identical across all modes**. State is tiny (players × scores/marks),
so memory cost is negligible; the win is eliminating a class of revert bugs. Undo stack is
bounded (default 60 entries).

---

## 3. Architecture & Data Flow

```
dart_hit (EventBus) ─▶ GameEngine ─▶ active GameMode (X01 | Cricket | AroundTheClock | FreePlay)
                          │  turn/visit state machine (3 darts; auto + manual advance; miss)
                          │  snapshot undo stack ; match structure (legs / optional sets)
                          ▼
                publishes game_started / game_state / bust / leg_won / game_won
                          (EventBus → WebSocket → overlay)
                          ▲
WebSocket (now BIDIRECTIONAL): inbound JSON command ─▶ validate (pydantic) ─▶ engine.handle_command()
```

- The **GameEngine** subscribes to the bus, filters `dart_hit`, and routes each dart to the
  active mode while owning turn flow, undo, and match structure. It publishes game events back
  to the **same bus**, so the existing WebSocket broadcast delivers them to clients with no change.
- The engine **never imports BLE code** — it consumes `dart_hit` events. Swapping
  `ReplayTransport` for real hardware makes the whole engine deterministically testable.
- The engine and `ConnectionManager` run as concurrent asyncio tasks under `granbridge serve`.

---

## 4. Component Inventory

*what it does / how it's used / what it depends on*

| Module | Responsibility | Depends on |
|--------|----------------|------------|
| `game/models.py` | `Player`, `Dart` (from a DartHit), `GameStatus` enum, `GameState` (generic: players, active index, current visit darts, legs/sets, status, winner, `mode_view` dict) | pydantic |
| `game/events.py` | Event models: `GameStarted`, `GameStateEvent`, `Bust`, `LegWon`, `GameWon` (subclass `BaseEvent`) | `events.models` |
| `game/commands.py` | Inbound command models + a discriminated union + parse/validate | pydantic |
| `game/modes/base.py` | `GameMode` ABC + `DartResult` (points, busted, leg_won, winner) | `game.models` |
| `game/modes/x01.py` | 301/501/701, double-in/out, bust, win-on-double; exposes checkout hint | `base`, `checkout` |
| `game/modes/cricket.py` | 15–20 + bull, 3 marks to close, points while open, standard win | `base` |
| `game/modes/around_the_clock.py` | Hit targets 1→20→bull in order (single/any configurable); win on bull | `base` |
| `game/modes/free_play.py` | No win condition; tracks darts, total, 3-dart avg, per-bed counts | `base` |
| `game/checkout.py` | X01 checkout suggestion: preferred-route table for ≤170 + search fallback; bogey numbers return none | — |
| `game/engine.py` | `GameEngine`: bus subscription, turn/visit state machine, snapshot undo, command handling, match structure, mode registry, event publication | `game.*`, `core.bus` |
| `api/ws_server.py` (modify) | Accept inbound JSON commands → validate → `engine.handle_command`; keep outbound broadcast + snapshot | `game.commands`, `game.engine` |
| `events/schema_export.py` (modify) | Include the 5 new game events in schema export | `game.events` |
| `cli.py` (modify) | `serve` constructs the engine, wires it to the bus + ws command path, runs it alongside `ConnectionManager` | `game.engine` |
| `overlay/game.html` | Minimal X01 scoreboard + checkout overlay consuming `game_state` (proves the loop; rich UI is a later sub-project) | — |

---

## 5. Contracts

### 5.1 New events (all extend `BaseEvent`: schema_version, type, timestamp)

- **`game_started`** — `{ mode, players: [{id,name}], options }`
- **`game_state`** — authoritative snapshot; the primary event. Fields: `mode`, `status`
  (`waiting|in_progress|finished`), `players`, `active_player`, `visit` (darts thrown this
  visit, each with bed/score), `legs`, `sets`, `winner` (id|null), and `mode_view` (mode-specific:
  X01 remaining + checkout hint; Cricket marks/points; ATC target; Free-play stats). Sent on
  every change and to new WS clients via snapshot.
- **`bust`** — `{ player, score_attempted, reason }`
- **`leg_won`** — `{ player, legs, sets }`
- **`game_won`** — `{ player }`

### 5.2 Inbound commands (validated; rejected commands emit an `error` event, `category:"decode"`-style `category:"command"`)

- **`start_game`** — `{ mode: "x01"|"cricket"|"around_the_clock"|"free_play", players: [names], options }`
  - X01 options: `start_score` (301/501/701), `double_in` (bool), `double_out` (bool),
    `best_of_legs` (int), `sets` (int, default 1).
  - Cricket options: `best_of_legs`.
  - ATC options: `targets` ("singles"|"any"), `include_bull` (bool).
- **`next_player`** — advance early; remaining darts of the visit are discarded (not misses).
- **`record_miss`** — log a 0-scoring thrown dart (bounce-out / no-register).
- **`undo`** — restore the previous snapshot.
- **`correct_last`** — `{ bed }` — undo the last dart, re-apply with the corrected bed
  (e.g. board read `S5` but it was `T20`).
- **`end_game`** — return to `waiting`.

> `error` event gains a `command` category for invalid/illegal commands (e.g. dart while
> `waiting`, illegal mode name). This is the only change to the existing `error` model.

---

## 6. Turn / Visit Model (engine-owned, shared across modes)

- A **visit** is up to **3 darts** for the active player.
- A `dart_hit` while `status == in_progress` is routed to the active mode's `apply_dart`.
- **Auto-advance:** after the 3rd registered dart, advance to the next player (new visit).
- **Manual:** `next_player` advances immediately; `record_miss` adds a 0 dart to the visit
  (and triggers auto-advance if it is the 3rd).
- **Bust:** if the mode flags the visit busted, restore the start-of-visit snapshot (voiding
  the visit's darts), emit `bust`, and advance.
- **Match structure:** modes that support legs/sets report `leg_won`/`game_won`; the engine
  tracks `legs`/`sets` per player and resets the board for the next leg, alternating the
  starting thrower.
- Per-player **in-memory stats** (darts thrown, total scored, 3-dart average) live in `GameState`.

---

## 7. GameMode Interface

```
class GameMode(ABC):
    name: str
    def on_start(self, state: GameState, options: dict) -> None        # init mode_view + scores
    def apply_dart(self, state: GameState, dart: Dart) -> DartResult     # score active player's dart
    def mode_view(self, state: GameState) -> dict                       # serializable mode-specific view
    def checkout_hint(self, state: GameState) -> list[str] | None        # X01 only; others None
```
`DartResult = { points: int, busted: bool, leg_won: bool, winner: str | None }`.
The engine handles snapshotting, turn flow, bust-revert, and match structure from these results;
modes contain only scoring + win rules + their view. This keeps each mode small and independently
testable.

---

## 8. Game Mode Rules (MVP)

- **X01:** start 301/501/701. Optional **double-in** (scoring starts only after a double) and
  **double-out** (must finish exactly on a double; finishing otherwise or leaving 1 = bust;
  going below 0 or below 2 with double-out = bust → revert visit). Checkout hint via §9.
- **Cricket:** numbers 15–20 + bull. 3 marks closes a number; while a number is open for you
  but not all opponents, further marks score that number's points. Win = all your numbers
  closed **and** points ≥ every opponent.
- **Around-the-Clock:** advance through targets 1→20 then bull, in order; `targets:"singles"`
  requires a single (or any hit if `"any"`); win on completing bull.
- **Free-play:** no win; accumulate darts, total, 3-dart average, and per-bed hit counts in
  `mode_view`. `end_game` finalizes.

---

## 9. X01 Checkout Suggestions

`checkout.suggest(remaining, darts_left, double_out) -> list[str] | None`:
- A seeded **preferred-route table** for common finishes ≤170 (e.g. 170→`T20 T20 Bull`,
  40→`D20`, 32→`D16`, 36→`D18`).
- Fallback **search** over 1–3 darts ending on a valid double (when double_out) for scores not
  in the table.
- **Bogey numbers** (169, 168, 166, 165, 163, 162, 159) and scores > 170 return `None`.
- Respects `darts_left` in the current visit (no suggestion needing more darts than remain).

---

## 10. Testing

- **Modes** are pure logic → table-driven tests: a dart sequence → expected score / bust / win.
  - X01: a 501 leg to a double-out checkout; double-in gating; bust (overshoot, leave-1,
    non-double finish).
  - Cricket: closing a number, scoring points while open, win condition, no-bust.
  - ATC: in-order progression, wrong-target no-op, bull finish.
  - Free-play: stat accumulation.
- **Checkout**: assert known outs (170, 167→`T20 T19 Bull`, 40, 32, 36) and that bogeys/>170 → None.
- **Engine**: inject darts directly and via `ReplayTransport`; assert turn rotation, auto-advance,
  `record_miss`, manual `next_player`, **undo**, **correct_last**, bust-revert, leg/match flow.
- **Commands**: valid/invalid parsing; illegal command in wrong state → `error` event.
- **End-to-end**: replay a dart sequence through the full bus → engine → `game_state` events.
- All tests hardware-free and CI-safe.

---

## 11. Repository Additions

```
src/granbridge/game/
  __init__.py
  models.py        commands.py        events.py        engine.py        checkout.py
  modes/__init__.py  modes/base.py  modes/x01.py  modes/cricket.py
  modes/around_the_clock.py  modes/free_play.py
src/granbridge/overlay/game.html          # minimal X01 scoreboard + checkout
tests/game/...                             # mirrors the above
# modified: api/ws_server.py (inbound commands), events/schema_export.py (game events),
#           cli.py (wire engine into serve)
```

---

## 12. Integration & No-Rework Note

The engine is a new **subscriber + publisher on the existing `EventBus`**; the BLE layer and
event models are untouched except: (a) `error` model gains a `command` category value, (b)
`ws_server` gains an inbound command path, (c) `schema_export` lists the new events, (d) `serve`
starts the engine task. No protocol/transport/decoder changes.

---

## 13. Code Quality Standards

Type hints throughout; pydantic models for state/events/commands; small single-purpose modules
(one file per mode); dependency injection (engine takes the bus + a mode registry); modes are
pure and independently testable. Reliability first (undo/bust correctness), then latency, then UX.
