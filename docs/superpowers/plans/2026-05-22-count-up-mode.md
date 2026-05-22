# Count-Up Game Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `count_up` game mode — N rounds of 3 darts, every dart's points accumulate, highest total wins — to the engine and UI.

**Architecture:** A new `CountUpMode` plugged into the existing `GameMode` contract, plus one backward-compatible engine change so the winner can be the highest scorer (not just whoever threw the last dart). A new `CountUpBoard` renders it; Setup + the Multiplayer start-panel expose it.

**Tech Stack:** Python 3.14 + pydantic (engine), pytest. React + TypeScript + Vitest (UI).

**Branch:** `count-up-mode` (already cut from `main`).

**Baseline (green at plan time):** 173 Python + 217 UI tests; `npm --prefix ui run build` clean.

---

## File Structure

- Create `src/granbridge/game/modes/count_up.py` — the `CountUpMode` (scoring, round tracking, winner).
- Modify `src/granbridge/game/engine.py` — honor `DartResult.winner`; register `count_up`.
- Create `tests/game/test_count_up.py` — mode behavior via the engine.
- Create `ui/src/components/boards/CountUpBoard.tsx` (+ test) — per-player totals + round header + leader.
- Modify `ui/src/views/LiveGame.tsx` — route `count_up` to `CountUpBoard`.
- Modify `ui/src/views/Setup.tsx` (+ test) — Count-Up option + `rounds` input.
- Modify `ui/src/views/Multiplayer.tsx` — Count-Up in the start-match mode select.
- Modify `docs/BUILD-LOG.md` — entry.

---

## Task 1: CountUpMode + engine winner-honoring (Python)

**Files:**
- Create: `src/granbridge/game/modes/count_up.py`
- Modify: `src/granbridge/game/engine.py`
- Test: `tests/game/test_count_up.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/game/test_count_up.py`:

```python
from granbridge.core.bus import EventBus
from granbridge.game.engine import GameEngine
from granbridge.game.commands import StartGame
from granbridge.game.models import Dart


def _engine():
    return GameEngine(EventBus())


def _start(eng, players, **opts):
    eng.handle_command(StartGame(command="start_game", mode="count_up", players=players, options=opts))


def _throw(eng, *beds):
    for b in beds:
        eng.on_dart(Dart.from_bed(b))


def test_scoring_accumulates():
    eng = _engine(); _start(eng, ["A"], rounds=8)
    _throw(eng, "T20", "T20", "T20")  # 180
    assert eng.state.mode_view["total"]["p1"] == 180


def test_bull_values_and_miss():
    eng = _engine(); _start(eng, ["A"], rounds=8)
    _throw(eng, "BULL", "DBULL", "MISS")  # 25 + 50 + 0
    assert eng.state.mode_view["total"]["p1"] == 75


def test_round_advances_after_three_darts():
    eng = _engine(); _start(eng, ["A"], rounds=8)
    assert eng.state.mode_view["current_round"] == 1
    _throw(eng, "S1", "S1", "S1")
    assert eng.state.mode_view["current_round"] == 2


def test_default_rounds_is_eight():
    eng = _engine(); _start(eng, ["A"])  # no rounds option
    assert eng.state.mode_view["rounds"] == 8


def test_rounds_option_respected():
    eng = _engine(); _start(eng, ["A"], rounds=3)
    assert eng.state.mode_view["rounds"] == 3


def test_solo_game_ends_after_n_rounds():
    eng = _engine(); _start(eng, ["A"], rounds=2)
    _throw(eng, "S5", "S5", "S5")          # round 1
    assert eng.state.status.value == "in_progress"
    _throw(eng, "S5", "S5", "S5")          # round 2 -> ends
    assert eng.state.status.value == "finished"
    assert eng.state.winner == "p1"


def test_winner_is_highest_not_last_thrower():
    # rounds=1, 2 players: p1 throws first (180), p2 throws last (3).
    # p2 is the active player on the final dart, but p1 has the highest total,
    # so the engine must declare p1 the winner (exercises `result.winner`).
    eng = _engine(); _start(eng, ["A", "B"], rounds=1)
    _throw(eng, "T20", "T20", "T20")       # p1: 180
    assert eng.state.active_index == 1
    _throw(eng, "S1", "S1", "S1")          # p2: 3, final dart -> ends
    assert eng.state.status.value == "finished"
    assert eng.state.winner == "p1"


def test_tie_goes_to_earlier_player():
    eng = _engine(); _start(eng, ["A", "B"], rounds=1)
    _throw(eng, "S5", "S5", "S5")          # p1: 15
    _throw(eng, "S5", "S5", "S5")          # p2: 15 (tie)
    assert eng.state.status.value == "finished"
    assert eng.state.winner == "p1"        # earlier player wins ties
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/game/test_count_up.py -q`
Expected: FAIL — `ErrorEvent`/unknown mode `count_up` (mode not registered), so `mode_view` lacks `total`.

- [ ] **Step 3: Create `src/granbridge/game/modes/count_up.py`**

```python
from __future__ import annotations

from typing import Any

from granbridge.game.models import Dart, GameState
from granbridge.game.modes.base import DartResult, GameMode


class CountUpMode(GameMode):
    """Count-Up: N rounds of 3 darts; every dart's points accumulate; highest total wins.

    No double-in/out and no bust — every dart scores (bull 25, double-bull 50).
    Assumes full 3-dart turns (the round counter keys off the active player's 3rd dart).
    """

    name = "count_up"

    def on_start(self, state: GameState, options: dict) -> None:
        rounds = max(1, int(options.get("rounds", 8)))
        state.options = {**state.options, **options}
        state.mode_view = {
            "total": {p.id: 0 for p in state.players},
            "hits": {p.id: {} for p in state.players},
            "rounds": rounds,
            "current_round": 1,
        }

    def apply_dart(self, state: GameState, dart: Dart) -> DartResult:
        pid = state.active_player_id
        view = state.mode_view
        view["total"][pid] += dart.score
        hits = view["hits"][pid]
        hits[dart.bed] = hits.get(dart.bed, 0) + 1

        is_last_dart = len(state.visit) == 2                       # this dart is the 3rd of the turn
        is_last_player = state.active_index == len(state.players) - 1
        if is_last_dart and is_last_player:
            if view["current_round"] >= view["rounds"]:
                return DartResult(points=dart.score, leg_won=True, winner=self._leader(state))
            view["current_round"] += 1
        return DartResult(points=dart.score)

    def mode_view(self, state: GameState) -> dict[str, Any]:
        return dict(state.mode_view)

    @staticmethod
    def _leader(state: GameState) -> str:
        """Player id with the highest total; ties broken by turn order (earliest)."""
        total = state.mode_view["total"]
        best_id = state.players[0].id
        for p in state.players:
            if total[p.id] > total[best_id]:
                best_id = p.id
        return best_id
```

- [ ] **Step 4: Wire it into `src/granbridge/game/engine.py` (two edits)**

(a) Honor `DartResult.winner`. The current `leg_won` branch in `on_dart` is:
```python
        if result.leg_won:
            self._on_leg_won(pid)
            return
```
Change it to:
```python
        if result.leg_won:
            self._on_leg_won(result.winner or pid)
            return
```
(For every existing mode `result.winner == pid`, so this is behavior-preserving.)

(b) Register the mode. Add the import alongside the other mode imports (after `from granbridge.game.modes.cricket import CricketMode`):
```python
from granbridge.game.modes.count_up import CountUpMode
```
And add it to `_REGISTRY`:
```python
_REGISTRY: dict[str, type[GameMode]] = {
    "x01": X01Mode, "cricket": CricketMode,
    "around_the_clock": AroundTheClockMode, "free_play": FreePlayMode,
    "count_up": CountUpMode,
}
```

- [ ] **Step 5: Run the new tests + full Python suite**

Run: `.venv/Scripts/python.exe -m pytest tests/game/test_count_up.py -q`
Expected: PASS (8 tests).
Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: PASS — 181 (173 baseline + 8). Existing X01/Cricket/ATC tests stay green (the `result.winner or pid` change is inert for them).

- [ ] **Step 6: Commit**

```bash
git add src/granbridge/game/modes/count_up.py src/granbridge/game/engine.py tests/game/test_count_up.py
git commit -m "feat(game): Count-Up mode (N rounds, highest total wins) + winner-honoring engine (parity)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: CountUpBoard + LiveGame routing (UI)

**Files:**
- Create: `ui/src/components/boards/CountUpBoard.tsx`
- Create: `ui/src/components/boards/CountUpBoard.test.tsx`
- Modify: `ui/src/views/LiveGame.tsx`

- [ ] **Step 1: Write the failing test**

Create `ui/src/components/boards/CountUpBoard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CountUpBoard } from "./CountUpBoard";
import type { GameState } from "../../types";

function state(): GameState {
  return {
    mode: "count_up", status: "in_progress",
    players: [{ id: "p1", name: "Ann" }, { id: "p2", name: "Bo" }],
    active_index: 0, visit: [], legs: {}, sets: {}, winner: null,
    options: {}, mode_view: { total: { p1: 140, p2: 60 }, rounds: 8, current_round: 3, hits: {} }, stats: {},
  };
}

describe("CountUpBoard", () => {
  it("shows each player's total and the round header", () => {
    render(<CountUpBoard state={state()} />);
    expect(screen.getByText("140")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText(/Round 3 \/ 8/i)).toBeInTheDocument();
  });

  it("marks the current leader", () => {
    render(<CountUpBoard state={state()} />);
    expect(screen.getByLabelText("leader")).toBeInTheDocument(); // p1 (140) leads
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix ui test -- boards/CountUpBoard`
Expected: FAIL — cannot resolve `./CountUpBoard`.

- [ ] **Step 3: Create `ui/src/components/boards/CountUpBoard.tsx`**

```tsx
import type { GameState } from "../../types";

export function CountUpBoard({ state }: { state: GameState }) {
  const total = (state.mode_view?.total ?? {}) as Record<string, number>;
  const currentRound = (state.mode_view?.current_round ?? 1) as number;
  const rounds = (state.mode_view?.rounds ?? 8) as number;
  const max = Math.max(0, ...Object.values(total));

  return (
    <div>
      <div className="text-center text-sm text-neutral-400 uppercase tracking-widest mb-4">
        Round {currentRound} / {rounds}
      </div>
      <div className="flex gap-6 justify-center flex-wrap">
        {state.players.map((p, i) => {
          const score = total[p.id] ?? 0;
          const isLeader = max > 0 && score === max;
          return (
            <div
              key={p.id}
              data-player={p.id}
              className={`rounded-2xl px-8 py-6 bg-neutral-800/70 min-w-[180px] text-center ${
                i === state.active_index ? "ring-4 ring-amber-400" : ""
              }`}
            >
              <div className="text-2xl text-neutral-300 flex items-center justify-center gap-2">
                {p.name}
                {isLeader && <span aria-label="leader" title="Leader">👑</span>}
              </div>
              <div className="text-7xl font-extrabold text-white tabular-nums">{score}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Route `count_up` in `ui/src/views/LiveGame.tsx`**

(a) Add the import alongside the other board imports (after `import { FreePlayBoard } from "../components/boards/FreePlayBoard";`):
```tsx
import { CountUpBoard } from "../components/boards/CountUpBoard";
```
(b) Add a case before the `default:` in the `board()` switch:
```tsx
      case "count_up":
        return <CountUpBoard state={state} />;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm --prefix ui test -- boards/CountUpBoard`
Expected: PASS (2).

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/boards/CountUpBoard.tsx ui/src/components/boards/CountUpBoard.test.tsx ui/src/views/LiveGame.tsx
git commit -m "feat(ui): CountUpBoard + LiveGame routing (parity)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Setup + Multiplayer Count-Up option

**Files:**
- Modify: `ui/src/views/Setup.tsx`
- Modify: `ui/src/views/Setup.test.tsx`
- Modify: `ui/src/views/Multiplayer.tsx`

- [ ] **Step 1: Write the failing test**

Read `ui/src/views/Setup.test.tsx` first, then append this test (it renders `<Setup send={vi.fn()} />`; the file already imports render/screen/fireEvent and vitest helpers — add `vi` to the import if absent):

```tsx
describe("Setup Count-Up", () => {
  it("offers Count-Up and reveals the rounds input when selected", () => {
    render(<Setup send={vi.fn()} />);
    const modeSelect = screen.getByLabelText("Mode");
    fireEvent.change(modeSelect, { target: { value: "count_up" } });
    expect(screen.getByLabelText(/rounds/i)).toBeInTheDocument();
  });

  it("submits start_game with the count_up mode and rounds option", () => {
    const send = vi.fn();
    render(<Setup send={send} />);
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "count_up" } });
    fireEvent.change(screen.getByLabelText("players"), { target: { value: "Ann" } });
    fireEvent.click(screen.getByRole("button", { name: /start game/i }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ command: "start_game", mode: "count_up", options: expect.objectContaining({ rounds: 8 }) }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix ui test -- views/Setup`
Expected: FAIL — no `count_up` option / no rounds input.

- [ ] **Step 3: Edit `ui/src/views/Setup.tsx`**

(a) Add a `rounds` state next to the other option state (after `const [bestOfLegs, setBestOfLegs] = useState(1);`):
```tsx
  const [rounds, setRounds] = useState(8);
```
(b) Add the option to the mode `<select>` (after the `free_play` option):
```tsx
            <option value="count_up">Count-Up</option>
```
(c) Extend the options builder in `handleSubmit`:
```tsx
    const options: Record<string, unknown> =
      mode === "x01"
        ? { start_score: startScore, double_out: doubleOut, best_of_legs: bestOfLegs }
        : mode === "count_up"
        ? { rounds }
        : {};
```
(d) Add a Count-Up options block (mirrors the X01 block) immediately AFTER the `{mode === "x01" && ( … )}` block:
```tsx
        {mode === "count_up" && (
          <div className="space-y-4 border border-neutral-700 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-widest">
              Count-Up Options
            </h3>
            <div>
              <label className={label} htmlFor="rounds">
                Rounds
              </label>
              <input
                id="rounds"
                aria-label="rounds"
                type="number"
                min={1}
                max={50}
                value={rounds}
                onChange={(e) => setRounds(Number(e.target.value))}
                className={`${input} w-24`}
              />
            </div>
          </div>
        )}
```

- [ ] **Step 4: Add the option to the Multiplayer start-match select**

In `ui/src/views/Multiplayer.tsx`, find the `<select … aria-label="Match mode">` and add the option after the `around_the_clock` one:
```tsx
                <option value="count_up">Count-Up</option>
```
(No other Multiplayer change — `handleStartMatch` already sends `{}` options for non-x01 modes, so Count-Up uses its default of 8 rounds in remote play.)

- [ ] **Step 5: Run the tests + full UI suite + build**

Run: `npm --prefix ui test -- views/Setup`
Expected: PASS (existing Setup tests + the 2 new ones).
Run: `npm --prefix ui test`
Expected: full UI suite green (217 baseline + Count-Up additions).
Run: `npm --prefix ui run build`
Expected: tsc clean + vite ok.

- [ ] **Step 6: Commit**

```bash
git add ui/src/views/Setup.tsx ui/src/views/Setup.test.tsx ui/src/views/Multiplayer.tsx
git commit -m "feat(ui): Count-Up in Setup (with rounds) + Multiplayer start panel (parity)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Docs — build-log entry

**Files:**
- Modify: `docs/BUILD-LOG.md`

- [ ] **Step 1: Append to `docs/BUILD-LOG.md`**

```markdown

### Count-Up mode ✅ (quick parity)
Spec `docs/superpowers/specs/2026-05-22-count-up-mode-design.md`; plan
`docs/superpowers/plans/2026-05-22-count-up-mode.md`. Built subagent-driven on `count-up-mode`.

- **Engine:** new `CountUpMode` — N rounds (default 8) of 3 darts, every dart accumulates (bull 25 /
  dbull 50, no bust/checkout), highest total wins (ties → earlier player). One backward-compatible
  engine tweak: `_on_leg_won(result.winner or pid)` so the winner can be the highest scorer rather
  than whoever threw the final dart (inert for X01/Cricket/ATC, which set `winner == pid`).
- **UI:** `CountUpBoard` (per-player totals + "Round x / y" + leader crown); Count-Up in the local
  Setup form (with a rounds input) and the Multiplayer start-match select (default rounds remotely).
- **Tests:** +8 Python (scoring/rounds/end/highest-total-wins-incl-non-last-thrower/tie/default/option)
  → 181 Python; +UI (CountUpBoard, Setup option/submit). Full suites + build green.
- **Limitation:** assumes full 3-dart turns (round counter keys off the 3rd dart); early `next_player`
  isn't a supported Count-Up action.

**Next:** Medley (a match of sequenced games — its own sub-project); real app icons.
```

- [ ] **Step 2: Commit**

```bash
git add docs/BUILD-LOG.md
git commit -m "docs: Count-Up mode build-log entry

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `.venv/Scripts/python.exe -m pytest -q` → 181 passed.
- [ ] `npm --prefix ui test` → full UI suite green.
- [ ] `npm --prefix ui run build` → clean.
- [ ] Then: final review, merge to `main`, push.

---

## Self-Review (against the spec)

**Spec coverage:**
- Engine honors `result.winner` → Task 1 step 4(a) + `test_winner_is_highest_not_last_thrower`. ✓
- `CountUpMode` (rounds default 8, accumulate, bull values, round tracking, end after N, winner=highest, ties→earlier, no bust/checkout) → Task 1 mode + tests. ✓
- Registration in `_REGISTRY` → Task 1 step 4(b). ✓
- `CountUpBoard` (totals + round header + leader) + `LiveGame` routing → Task 2. ✓
- Setup option + rounds input + options wiring → Task 3 (with 2 tests). ✓
- Multiplayer start-panel option → Task 3 step 4. ✓
- Docs + limitation → Task 4. ✓
- `types.ts` no change (mode is string) — confirmed, no task needed. ✓

**Placeholder scan:** none — every step has real code/tests/commands. (Task 3 step 1 instructs reading `Setup.test.tsx` to append, with the full test code provided.)

**Type consistency:** mode_view keys `total`/`hits`/`rounds`/`current_round` are identical across the Python mode (Task 1), the board (Task 2), and the board test. `rounds` option name matches between Setup (Task 3), the mode (`options.get("rounds", 8)`, Task 1), and the test. Mode string `"count_up"` is consistent across engine `_REGISTRY`, LiveGame `case`, Setup/Multiplayer `<option>`, and tests. `_leader` returns a player id (string) → `DartResult.winner` (Optional[str]) → engine `_on_leg_won(str)`. No mismatches.
