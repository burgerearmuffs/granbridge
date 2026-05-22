# Medley Game Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `medley` mode — a match of a sequence of different games played as successive legs (best-of-N) — reusing the existing sub-modes and the engine's best-of-legs machinery.

**Architecture:** A pure additive `MedleyMode` that delegates each leg to an existing sub-mode (chosen from a sequence stored in `mode_view["medley"]`, advanced on each `on_start`) and sets `best_of_legs = len(sequence)` so the engine runs the match. A `MedleyBoard` shows a header + the existing sub-board. **No engine logic changes** (only a registry line).

**Tech Stack:** Python 3.14 + pydantic, pytest. React + TypeScript + Vitest.

**Branch:** `medley-mode` (already cut from `main`).

**Baseline (green at plan time):** 182 Python + 221 UI tests; `npm --prefix ui run build` clean.

---

## File Structure
- Create `src/granbridge/game/modes/medley.py` — `MedleyMode` (delegates per-leg; sequence in `mode_view`).
- Modify `src/granbridge/game/engine.py` — register `medley` (import + `_REGISTRY` line; NO logic change).
- Create `tests/game/test_medley.py` — mode behavior via the engine.
- Create `ui/src/components/boards/MedleyBoard.tsx` (+ test) — header + sub-board delegation.
- Modify `ui/src/views/LiveGame.tsx` — route `medley`.
- Modify `ui/src/views/Setup.tsx` (+ test) + `ui/src/views/Multiplayer.tsx` — Medley option.
- Modify `docs/BUILD-LOG.md`.

---

## Task 1: MedleyMode + registration (Python)

**Files:**
- Create: `src/granbridge/game/modes/medley.py`
- Modify: `src/granbridge/game/engine.py`
- Test: `tests/game/test_medley.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/game/test_medley.py`:

```python
from granbridge.core.bus import EventBus
from granbridge.game.engine import GameEngine
from granbridge.game.commands import StartGame, Undo
from granbridge.game.models import Dart


def _engine():
    return GameEngine(EventBus())


def _start(eng, players, **opts):
    eng.handle_command(StartGame(command="start_game", mode="medley", players=players, options=opts))


def _throw(eng, *beds):
    for b in beds:
        eng.on_dart(Dart.from_bed(b))


def test_default_sequence_and_first_leg():
    eng = _engine(); _start(eng, ["A"])
    m = eng.state.mode_view["medley"]
    assert m["sequence"] == ["x01", "cricket", "count_up"]
    assert m["index"] == 0 and m["current"] == "x01"
    assert int(eng.state.options["best_of_legs"]) == 3
    # x01 sub-mode keys are present at top level
    assert "scores" in eng.state.mode_view


def test_winning_a_leg_advances_the_sequence():
    # count_up rounds=1 → a solo player wins leg 1 in one round (3 darts).
    eng = _engine(); _start(eng, ["A"], sequence=["count_up", "x01"], rounds=1)
    assert eng.state.mode_view["medley"]["current"] == "count_up"
    _throw(eng, "S5", "S5", "S5")            # leg 1 (count_up) done
    assert eng.state.status.value == "in_progress"          # best_of_legs=2 → not over yet
    assert eng.state.mode_view["medley"]["current"] == "x01"
    assert eng.state.mode_view["medley"]["index"] == 1
    assert "scores" in eng.state.mode_view                  # now showing the x01 sub-view


def test_match_ends_after_majority_of_legs():
    # 2-game medley, solo player wins both → match over after leg 2.
    eng = _engine(); _start(eng, ["A"], sequence=["count_up", "count_up"], rounds=1)
    _throw(eng, "S5", "S5", "S5")            # leg 1
    assert eng.state.status.value == "in_progress"
    _throw(eng, "S5", "S5", "S5")            # leg 2 -> legs_needed (2) reached
    assert eng.state.status.value == "finished"
    assert eng.state.winner == "p1"


def test_unknown_sub_mode_aborts_start():
    eng = _engine(); _start(eng, ["A"], sequence=["x01", "nope"])
    assert eng.state.mode == "none"                          # start aborted on the bad sequence
    assert any(getattr(e, "category", None) == "command" for e in eng._pending)


def test_undo_across_leg_boundary():
    eng = _engine(); _start(eng, ["A"], sequence=["count_up", "x01"], rounds=1)
    _throw(eng, "S5", "S5", "S5")            # win leg 1 -> advanced to x01
    assert eng.state.mode_view["medley"]["current"] == "x01"
    eng.handle_command(Undo(command="undo"))
    assert eng.state.mode_view["medley"]["current"] == "count_up"   # back to leg 1
    # the mode still works after undo (count_up scores)
    before = eng.state.mode_view["total"]["p1"]
    eng.on_dart(Dart.from_bed("S20"))
    assert eng.state.mode_view["total"]["p1"] == before + 20
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/Scripts/python.exe -m pytest tests/game/test_medley.py -q`
Expected: FAIL — unknown mode `medley` (not registered).

- [ ] **Step 3: Create `src/granbridge/game/modes/medley.py`**

```python
from __future__ import annotations

from typing import Any

from granbridge.game.models import Dart, GameState
from granbridge.game.modes.around_the_clock import AroundTheClockMode
from granbridge.game.modes.base import DartResult, GameMode
from granbridge.game.modes.count_up import CountUpMode
from granbridge.game.modes.cricket import CricketMode
from granbridge.game.modes.x01 import X01Mode

# Leg-ending sub-modes only (free_play never ends a leg; medley would recurse).
_SUB_MODES: dict[str, type[GameMode]] = {
    "x01": X01Mode,
    "cricket": CricketMode,
    "around_the_clock": AroundTheClockMode,
    "count_up": CountUpMode,
}

DEFAULT_SEQUENCE = ["x01", "cricket", "count_up"]


class MedleyMode(GameMode):
    """A match of a sequence of games, one per leg, run by the engine's best-of-legs logic.

    Instance-stateless: the sequence + index live in state.mode_view["medley"], so undo
    (which re-instantiates the mode from the registry) is safe. Sets best_of_legs to the
    sequence length so the engine ends the match at the first player to win a majority of legs.
    """

    name = "medley"

    def on_start(self, state: GameState, options: dict) -> None:
        prior = state.mode_view.get("medley") if isinstance(state.mode_view, dict) else None
        if prior is None:
            sequence = list(options.get("sequence") or DEFAULT_SEQUENCE)
            for m in sequence:
                if m not in _SUB_MODES:
                    raise ValueError(f"unknown medley sub-mode {m!r}")
            index = 0
            state.options = {**state.options, **options}
            state.options["best_of_legs"] = len(sequence)
            state.options["best_of_sets"] = 1
        else:
            sequence = prior["sequence"]
            index = prior["index"] + 1

        current = sequence[index]
        _SUB_MODES[current]().on_start(state, options)            # sets the sub-mode's mode_view keys
        state.mode_view["medley"] = {"sequence": sequence, "index": index, "current": current}

    def apply_dart(self, state: GameState, dart: Dart) -> DartResult:
        current = state.mode_view["medley"]["current"]
        return _SUB_MODES[current]().apply_dart(state, dart)

    def mode_view(self, state: GameState) -> dict[str, Any]:
        medley = state.mode_view["medley"]
        view = _SUB_MODES[medley["current"]]().mode_view(state)   # sub-mode view (incl. e.g. x01 checkout)
        view["medley"] = medley
        return view
```

- [ ] **Step 4: Register in `src/granbridge/game/engine.py`**

Add the import alongside the other mode imports (after `from granbridge.game.modes.x01 import X01Mode`):
```python
from granbridge.game.modes.medley import MedleyMode
```
Add `"medley": MedleyMode` to `_REGISTRY` so it reads:
```python
_REGISTRY: dict[str, type[GameMode]] = {
    "x01": X01Mode, "cricket": CricketMode,
    "around_the_clock": AroundTheClockMode, "free_play": FreePlayMode,
    "count_up": CountUpMode, "medley": MedleyMode,
}
```
(No other engine change.)

- [ ] **Step 5: Run the new tests + full Python suite**

Run: `.venv/Scripts/python.exe -m pytest tests/game/test_medley.py -q`  → Expected: PASS (5).
Run: `.venv/Scripts/python.exe -m pytest -q`  → Expected: 187 passed (182 + 5). All existing mode/engine tests green.

- [ ] **Step 6: Commit**

```bash
git add src/granbridge/game/modes/medley.py src/granbridge/game/engine.py tests/game/test_medley.py
git commit -m "feat(game): Medley mode (sequence of games as best-of-N legs) (parity)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: MedleyBoard + LiveGame routing (UI)

**Files:**
- Create: `ui/src/components/boards/MedleyBoard.tsx`
- Create: `ui/src/components/boards/MedleyBoard.test.tsx`
- Modify: `ui/src/views/LiveGame.tsx`

- [ ] **Step 1: Write the failing test**

Create `ui/src/components/boards/MedleyBoard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MedleyBoard } from "./MedleyBoard";
import type { GameState } from "../../types";

function baseState(): GameState {
  return {
    mode: "medley", status: "in_progress",
    players: [{ id: "p1", name: "Ann" }, { id: "p2", name: "Bo" }],
    active_index: 0, visit: [], legs: { p1: 0, p2: 0 }, sets: {}, winner: null,
    options: {}, mode_view: {}, stats: {},
  };
}

describe("MedleyBoard", () => {
  it("shows the medley header and delegates to the X01 sub-board", () => {
    const s = baseState();
    s.mode_view = { scores: { p1: 421, p2: 501 }, medley: { sequence: ["x01", "cricket", "count_up"], index: 0, current: "x01" } };
    render(<MedleyBoard state={s} />);
    expect(screen.getByText(/Game 1 \/ 3/i)).toBeInTheDocument();
    expect(screen.getByText(/X01/i)).toBeInTheDocument();
    expect(screen.getByText("421")).toBeInTheDocument();   // X01Board rendered the score
  });

  it("delegates to the Count-Up sub-board when current is count_up", () => {
    const s = baseState();
    s.mode_view = { total: { p1: 90, p2: 60 }, rounds: 8, current_round: 2, medley: { sequence: ["count_up", "x01"], index: 0, current: "count_up" } };
    render(<MedleyBoard state={s} />);
    expect(screen.getByText(/Game 1 \/ 2/i)).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();    // CountUpBoard total
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm --prefix ui test -- boards/MedleyBoard`
Expected: FAIL — cannot resolve `./MedleyBoard`.

- [ ] **Step 3: Create `ui/src/components/boards/MedleyBoard.tsx`**

```tsx
import type { GameState } from "../../types";
import { X01Board } from "./X01Board";
import { CricketBoard } from "./CricketBoard";
import { AtcBoard } from "./AtcBoard";
import { CountUpBoard } from "./CountUpBoard";

const LABELS: Record<string, string> = {
  x01: "X01",
  cricket: "Cricket",
  around_the_clock: "Around the Clock",
  count_up: "Count-Up",
};

export function MedleyBoard({ state }: { state: GameState }) {
  const medley = state.mode_view?.medley as
    | { sequence: string[]; index: number; current: string }
    | undefined;

  if (!medley) {
    return <div className="text-center text-neutral-400 py-8">Medley starting…</div>;
  }

  const sub = () => {
    switch (medley.current) {
      case "x01":
        return <X01Board state={state} />;
      case "cricket":
        return <CricketBoard state={state} />;
      case "around_the_clock":
        return <AtcBoard state={state} />;
      case "count_up":
        return <CountUpBoard state={state} />;
      default:
        return <div className="text-center text-neutral-400">Unknown game: {medley.current}</div>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center text-sm text-amber-300 uppercase tracking-widest font-semibold">
        Game {medley.index + 1} / {medley.sequence.length} — {LABELS[medley.current] ?? medley.current}
      </div>
      {sub()}
    </div>
  );
}
```

- [ ] **Step 4: Route `medley` in `ui/src/views/LiveGame.tsx`**

(a) Add the import alongside the other board imports (after the `CountUpBoard` import added in the Count-Up work):
```tsx
import { MedleyBoard } from "../components/boards/MedleyBoard";
```
(b) Add a case before `default:` in the `board()` switch:
```tsx
      case "medley":
        return <MedleyBoard state={state} />;
```

- [ ] **Step 5: Run to verify pass**

Run: `npm --prefix ui test -- boards/MedleyBoard`
Expected: PASS (2).

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/boards/MedleyBoard.tsx ui/src/components/boards/MedleyBoard.test.tsx ui/src/views/LiveGame.tsx
git commit -m "feat(ui): MedleyBoard (header + sub-board delegation) + LiveGame routing (parity)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Setup + Multiplayer Medley option

**Files:**
- Modify: `ui/src/views/Setup.tsx`
- Modify: `ui/src/views/Setup.test.tsx`
- Modify: `ui/src/views/Multiplayer.tsx`

- [ ] **Step 1: Write the failing test**

Read `ui/src/views/Setup.test.tsx` first, then append (the file imports render/screen/fireEvent + `vi`):

```tsx
describe("Setup Medley", () => {
  it("offers Medley and submits start_game with the medley mode", () => {
    const send = vi.fn();
    render(<Setup send={send} />);
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "medley" } });
    fireEvent.change(screen.getByLabelText("players"), { target: { value: "Ann, Bo" } });
    fireEvent.click(screen.getByRole("button", { name: /start game/i }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ command: "start_game", mode: "medley" }),
    );
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm --prefix ui test -- views/Setup`
Expected: FAIL — no `medley` option.

- [ ] **Step 3: Edit `ui/src/views/Setup.tsx`**

(a) Add the option to the mode `<select>` after the `count_up` option:
```tsx
            <option value="medley">Medley</option>
```
(b) Add a small static note block immediately AFTER the `{mode === "count_up" && ( … )}` block (no options needed — Medley uses the default sequence; the existing options ternary already returns `{}` for any non-x01/non-count_up mode):
```tsx
        {mode === "medley" && (
          <div className="space-y-2 border border-neutral-700 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-widest">
              Medley
            </h3>
            <p className="text-sm text-neutral-400">
              A best-of-3 match: X01 (501), then Cricket, then Count-Up. First to win 2 games takes the match.
            </p>
          </div>
        )}
```
(The `handleSubmit` options ternary is unchanged — `medley` falls through to `{}`, so the mode applies its default sequence.)

- [ ] **Step 4: Add the option to the Multiplayer start-match select**

In `ui/src/views/Multiplayer.tsx`, find the `<select … aria-label="Match mode">` and add after the `count_up` option (added in the Count-Up work):
```tsx
                <option value="medley">Medley</option>
```

- [ ] **Step 5: Run tests + full UI suite + build**

Run: `npm --prefix ui test -- views/Setup`  → Expected: PASS (existing + the new Medley test).
Run: `npm --prefix ui test`  → Expected: full UI suite green.
Run: `npm --prefix ui run build`  → Expected: tsc clean + vite ok.

- [ ] **Step 6: Commit**

```bash
git add ui/src/views/Setup.tsx ui/src/views/Setup.test.tsx ui/src/views/Multiplayer.tsx
git commit -m "feat(ui): Medley in Setup + Multiplayer start panel (parity)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Docs — build-log entry

**Files:**
- Modify: `docs/BUILD-LOG.md`

- [ ] **Step 1: Append to `docs/BUILD-LOG.md`**

```markdown

### Medley mode ✅ (quick parity)
Spec `docs/superpowers/specs/2026-05-22-medley-mode-design.md`; plan
`docs/superpowers/plans/2026-05-22-medley-mode.md`. Built subagent-driven on `medley-mode`.

- **Engine:** new `MedleyMode` — a match of a sequence of games (default `[x01, cricket, count_up]`),
  one per leg, run as **best-of-N** by the engine's existing best-of-legs machinery (`MedleyMode` sets
  `best_of_legs = len(sequence)`). It delegates each leg to the existing sub-mode and advances the
  sequence inside `on_start` (the engine's per-leg hook). Sequence/index live in `mode_view["medley"]`,
  so it is instance-stateless and undo-safe. **No engine logic change** — only a registry line.
- **UI:** `MedleyBoard` renders a "Game x / N — <mode>" header and delegates to the existing sub-board
  (X01/Cricket/ATC/Count-Up). Medley in the local Setup form (default sequence) + the Multiplayer
  start-match select.
- **Tests:** +5 Python (default sequence/first leg, leg-win advances the sequence, match ends at the
  majority of legs, unknown sub-mode aborts start, undo across a leg boundary) → 187 Python; +UI
  (MedleyBoard delegation ×2, Setup option). Full suites + build green.
- **Limitations:** sub-modes use default options inside a medley (501 X01, 8-round Count-Up); a custom
  sequence-picker UI is deferred (the mode supports `options.sequence`); `free_play`/`medley` can't be
  sequence entries.

**Next:** real app icons; (later) server-side profiles/accounts.
```

- [ ] **Step 2: Commit**

```bash
git add docs/BUILD-LOG.md
git commit -m "docs: Medley mode build-log entry

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)
- [ ] `.venv/Scripts/python.exe -m pytest -q` → 187 passed.
- [ ] `npm --prefix ui test` → full UI suite green.
- [ ] `npm --prefix ui run build` → clean.
- [ ] Then: final review, merge to `main`, push.

---

## Self-Review (against the spec)

**Spec coverage:**
- `MedleyMode` delegates per-leg, sequence in `mode_view`, advances in `on_start`, sets `best_of_legs=len` → Task 1 + tests. ✓
- Instance-stateless / undo-safe → Task 1 `test_undo_across_leg_boundary`. ✓
- Unknown sub-mode validation/error → Task 1 `test_unknown_sub_mode_aborts_start`. ✓
- Registration (registry line only, no logic change) → Task 1 step 4. ✓
- `MedleyBoard` header + sub-board delegation + `LiveGame` routing → Task 2. ✓
- Setup option (default sequence, `{}` options) + Multiplayer option → Task 3. ✓
- Docs + limitations → Task 4. ✓
- `types.ts` no change (mode is string) — confirmed. ✓

**Placeholder scan:** none — every step has real code/tests/commands. (Task 3 step 1 directs reading `Setup.test.tsx` to append; full test provided.)

**Type consistency:** `mode_view["medley"]` shape `{sequence, index, current}` is identical in the Python mode (Task 1) and the board + board test (Task 2). The sub-mode keys MedleyBoard's sub-boards read (`scores` for x01, `total`/`current_round`/`rounds` for count_up) match what the Python sub-modes write (verified against x01.py/count_up.py). `_SUB_MODES` keys (`x01`/`cricket`/`around_the_clock`/`count_up`) match the `LABELS`/switch in MedleyBoard and the engine `_REGISTRY` mode names. `"medley"` string consistent across engine registry, LiveGame case, Setup/Multiplayer options, and tests. No mismatches.
