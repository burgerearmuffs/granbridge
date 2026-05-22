# GRANBRIDGE Game Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Subagents do NOT commit (controller squash-commits at checkpoints through the Opsera flag). Tasks 6–9 (the four game modes) are PARALLEL-SAFE once Tasks 1–5 land: disjoint files, each runs only its own test file.

**Goal:** Turn the `dart_hit` event stream into playable X01, Cricket, and practice games, controllable over a bidirectional WebSocket, with undo/correct-misread and live `game_state` events.

**Architecture:** A `GameEngine` subscribes to the existing `EventBus`, owns the turn/visit state machine + snapshot-based undo + match structure, and delegates scoring to a pluggable `GameMode` (Strategy). It publishes game events back to the bus (→ WebSocket → overlay). The WebSocket server gains an inbound command path. The engine never imports BLE code.

**Tech Stack:** Python 3.12+, asyncio, pydantic v2, structlog, pytest. Reuses `granbridge.core.bus`, `granbridge.events.models`, `granbridge.api.ws_server`.

UI note: overlays MUST use safe DOM construction (`document.createElement` + `textContent` / `replaceChildren`), never `innerHTML` with interpolated state — player names are user-supplied.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/granbridge/game/__init__.py` | package marker |
| `src/granbridge/game/models.py` | `Player`, `Dart`, `PlayerStats`, `GameStatus`, `GameState` |
| `src/granbridge/game/events.py` | `GameStarted`, `GameStateEvent`, `Bust`, `LegWon`, `GameWon` |
| `src/granbridge/game/commands.py` | command models + `parse_command()` |
| `src/granbridge/game/modes/base.py` | `GameMode` ABC + `DartResult` |
| `src/granbridge/game/checkout.py` | X01 checkout suggestion |
| `src/granbridge/game/modes/x01.py` | X01 rules |
| `src/granbridge/game/modes/cricket.py` | Cricket rules |
| `src/granbridge/game/modes/around_the_clock.py` | ATC practice |
| `src/granbridge/game/modes/free_play.py` | Free-play practice |
| `src/granbridge/game/engine.py` | `GameEngine`: turn machine, undo, commands, mode registry, bus I/O |
| `src/granbridge/api/ws_server.py` (modify) | inbound command path |
| `src/granbridge/events/models.py` (modify) | add `"command"` to `ErrorEvent.category` |
| `src/granbridge/events/schema_export.py` (modify) | include game events |
| `src/granbridge/cli.py` (modify) | wire engine into `serve` |
| `src/granbridge/overlay/game.html` | minimal X01 scoreboard + checkout |
| `tests/game/...` | mirrors source |

Run tests via `.venv\Scripts\python -m pytest`. Do NOT commit (controller handles it).

---

## Task 1: Game models

**Files:** Create `src/granbridge/game/__init__.py`, `src/granbridge/game/models.py`; `tests/game/__init__.py`, `tests/game/test_models.py`.

- [ ] **Step 1: Write the failing test** (`tests/game/test_models.py`)

```python
from granbridge.game.models import Dart, GameState, GameStatus, Player, PlayerStats

def test_dart_from_bed_parses_all_ring_types():
    assert (Dart.from_bed("T20").score, Dart.from_bed("T20").multiplier) == (60, 3)
    assert (Dart.from_bed("D16").score, Dart.from_bed("D16").segment) == (32, 16)
    assert (Dart.from_bed("S5").score, Dart.from_bed("S5").multiplier) == (5, 1)
    assert Dart.from_bed("BULL").score == 25 and Dart.from_bed("BULL").segment == 25
    assert Dart.from_bed("DBULL").score == 50 and Dart.from_bed("DBULL").multiplier == 2
    miss = Dart.from_bed("MISS")
    assert miss.score == 0 and miss.segment is None and miss.multiplier == 0

def test_player_stats_three_dart_average():
    s = PlayerStats(darts=6, total_scored=180)
    assert s.three_dart_avg == 90.0
    assert PlayerStats().three_dart_avg == 0.0

def test_gamestate_active_player_id():
    gs = GameState(mode="x01", players=[Player(id="p1", name="A"), Player(id="p2", name="B")], active_index=1)
    assert gs.active_player_id == "p2"
    assert gs.status == GameStatus.WAITING
```

- [ ] **Step 2: Run to verify FAIL** — `pytest tests/game/test_models.py -v` → ModuleNotFoundError.

- [ ] **Step 3: Implement** (`src/granbridge/game/models.py`)

```python
from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, computed_field


class GameStatus(str, Enum):
    WAITING = "waiting"
    IN_PROGRESS = "in_progress"
    FINISHED = "finished"


class Player(BaseModel):
    id: str
    name: str


class Dart(BaseModel):
    bed: str
    ring: str
    segment: Optional[int]
    multiplier: int
    score: int

    @classmethod
    def from_bed(cls, bed: str) -> "Dart":
        bed = bed.upper().strip()
        if bed in ("MISS", "OUT", ""):
            return cls(bed="MISS", ring="OUT", segment=None, multiplier=0, score=0)
        if bed == "BULL":
            return cls(bed="BULL", ring="SBULL", segment=25, multiplier=1, score=25)
        if bed == "DBULL":
            return cls(bed="DBULL", ring="DBULL", segment=25, multiplier=2, score=50)
        prefix, number = bed[0], int(bed[1:])
        mult = {"S": 1, "D": 2, "T": 3}[prefix]
        ring = {"S": "SO", "D": "D", "T": "T"}[prefix]
        return cls(bed=bed, ring=ring, segment=number, multiplier=mult, score=number * mult)


class PlayerStats(BaseModel):
    darts: int = 0
    total_scored: int = 0

    @computed_field  # type: ignore[prop-decorator]
    @property
    def three_dart_avg(self) -> float:
        return round(self.total_scored / self.darts * 3, 2) if self.darts else 0.0


class GameState(BaseModel):
    mode: str
    status: GameStatus = GameStatus.WAITING
    players: list[Player] = []
    active_index: int = 0
    visit: list[Dart] = []
    legs: dict[str, int] = {}
    sets: dict[str, int] = {}
    winner: Optional[str] = None
    options: dict[str, Any] = {}
    mode_view: dict[str, Any] = {}
    stats: dict[str, PlayerStats] = {}

    @property
    def active_player_id(self) -> Optional[str]:
        if not self.players:
            return None
        return self.players[self.active_index % len(self.players)].id
```

- [ ] **Step 4: Run to verify PASS** — `pytest tests/game/test_models.py -v` → 3 passed.

---

## Task 2: Game events + error category

**Files:** Create `src/granbridge/game/events.py`, `tests/game/test_events.py`. Modify `src/granbridge/events/models.py` (ErrorEvent category) and `src/granbridge/events/schema_export.py`.

- [ ] **Step 1: Write failing test** (`tests/game/test_events.py`)

```python
import json
from granbridge.game.events import GameStarted, GameStateEvent, Bust, LegWon, GameWon
from granbridge.game.models import GameState
from granbridge.events.models import ErrorEvent

def test_game_state_event_wraps_state():
    gs = GameState(mode="x01")
    ev = GameStateEvent(state=gs)
    data = json.loads(ev.model_dump_json())
    assert data["type"] == "game_state" and data["state"]["mode"] == "x01"

def test_transition_events_types():
    assert GameStarted(mode="x01", players=[], options={}).type == "game_started"
    assert Bust(player="p1", score_attempted=10, reason="overshoot").type == "bust"
    assert LegWon(player="p1", legs=1, sets=0).type == "leg_won"
    assert GameWon(player="p1").type == "game_won"

def test_error_event_accepts_command_category():
    assert ErrorEvent(category="command", message="bad").category == "command"
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement** `src/granbridge/game/events.py`

```python
from __future__ import annotations

from typing import Any, Literal

from granbridge.events.models import BaseEvent
from granbridge.game.models import GameState, Player


class GameStarted(BaseEvent):
    type: Literal["game_started"] = "game_started"
    mode: str
    players: list[Player]
    options: dict[str, Any]


class GameStateEvent(BaseEvent):
    type: Literal["game_state"] = "game_state"
    state: GameState


class Bust(BaseEvent):
    type: Literal["bust"] = "bust"
    player: str
    score_attempted: int
    reason: str


class LegWon(BaseEvent):
    type: Literal["leg_won"] = "leg_won"
    player: str
    legs: int
    sets: int


class GameWon(BaseEvent):
    type: Literal["game_won"] = "game_won"
    player: str
```

- [ ] **Step 4: Modify `src/granbridge/events/models.py`** — change `ErrorEvent.category` to include `"command"`:

```python
    category: Literal["ble", "decode", "transport", "command"]
```

- [ ] **Step 5: Modify `src/granbridge/events/schema_export.py`** — import the game events and add to `_EVENT_TYPES`:

```python
from granbridge.game.events import Bust, GameStarted, GameStateEvent, GameWon, LegWon
# ... add to the _EVENT_TYPES dict:
    "game_started": GameStarted,
    "game_state": GameStateEvent,
    "bust": Bust,
    "leg_won": LegWon,
    "game_won": GameWon,
```

- [ ] **Step 6: Run** `pytest tests/game/test_events.py tests/events -v` → all pass. Regenerate schemas:
`.venv\Scripts\python -c "from pathlib import Path; from granbridge.events.schema_export import export_schemas; export_schemas(Path('src/granbridge/events/schema'))"`

---

## Task 3: Commands

**Files:** Create `src/granbridge/game/commands.py`, `tests/game/test_commands.py`.

- [ ] **Step 1: Write failing test**

```python
import pytest
from granbridge.game.commands import parse_command, StartGame, NextPlayer, Undo, CorrectLast, RecordMiss, EndGame

def test_parse_start_game():
    cmd = parse_command({"command": "start_game", "mode": "x01", "players": ["A", "B"], "options": {"start_score": 501}})
    assert isinstance(cmd, StartGame) and cmd.mode == "x01" and cmd.players == ["A", "B"]

def test_parse_simple_commands():
    assert isinstance(parse_command({"command": "next_player"}), NextPlayer)
    assert isinstance(parse_command({"command": "undo"}), Undo)
    assert isinstance(parse_command({"command": "record_miss"}), RecordMiss)
    assert isinstance(parse_command({"command": "end_game"}), EndGame)

def test_parse_correct_last():
    cmd = parse_command({"command": "correct_last", "bed": "T20"})
    assert isinstance(cmd, CorrectLast) and cmd.bed == "T20"

def test_parse_unknown_raises():
    with pytest.raises(ValueError):
        parse_command({"command": "nope"})
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Implement** `src/granbridge/game/commands.py`

```python
from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel


class StartGame(BaseModel):
    command: Literal["start_game"]
    mode: str
    players: list[str]
    options: dict[str, Any] = {}


class NextPlayer(BaseModel):
    command: Literal["next_player"]


class RecordMiss(BaseModel):
    command: Literal["record_miss"]


class Undo(BaseModel):
    command: Literal["undo"]


class CorrectLast(BaseModel):
    command: Literal["correct_last"]
    bed: str


class EndGame(BaseModel):
    command: Literal["end_game"]


Command = Union[StartGame, NextPlayer, RecordMiss, Undo, CorrectLast, EndGame]

_BY_NAME = {
    "start_game": StartGame, "next_player": NextPlayer, "record_miss": RecordMiss,
    "undo": Undo, "correct_last": CorrectLast, "end_game": EndGame,
}


def parse_command(payload: dict) -> Command:
    name = payload.get("command")
    model = _BY_NAME.get(name)
    if model is None:
        raise ValueError(f"unknown command: {name!r}")
    return model.model_validate(payload)
```

- [ ] **Step 4: Run PASS.**

---

## Task 4: GameMode base + DartResult

**Files:** Create `src/granbridge/game/modes/__init__.py`, `src/granbridge/game/modes/base.py`, `tests/game/modes/__init__.py`, `tests/game/modes/test_base.py`.

- [ ] **Step 1: Write failing test**

```python
import pytest
from granbridge.game.modes.base import GameMode, DartResult

def test_dart_result_defaults():
    r = DartResult(points=20)
    assert r.points == 20 and r.busted is False and r.leg_won is False and r.winner is None

def test_gamemode_is_abstract():
    with pytest.raises(TypeError):
        GameMode()  # abstract
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Implement** `src/granbridge/game/modes/base.py`

```python
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Optional

from pydantic import BaseModel

from granbridge.game.models import Dart, GameState


class DartResult(BaseModel):
    points: int = 0
    busted: bool = False
    leg_won: bool = False
    winner: Optional[str] = None


class GameMode(ABC):
    name: str = "base"

    @abstractmethod
    def on_start(self, state: GameState, options: dict) -> None:
        """Initialize mode_view and any per-player scores for a new leg."""

    @abstractmethod
    def apply_dart(self, state: GameState, dart: Dart) -> DartResult:
        """Score `dart` for the active player; mutate state.mode_view."""

    @abstractmethod
    def mode_view(self, state: GameState) -> dict[str, Any]:
        """Serializable mode-specific view for the game_state event."""

    def checkout_hint(self, state: GameState) -> Optional[list[str]]:
        return None
```

- [ ] **Step 4: Run PASS.**

---

## Task 5: Checkout

**Files:** Create `src/granbridge/game/checkout.py`, `tests/game/test_checkout.py`.

- [ ] **Step 1: Write failing test**

```python
from granbridge.game.checkout import suggest

def test_known_checkouts():
    assert suggest(170, 3, True) == ["T20", "T20", "BULL"]
    assert suggest(167, 3, True) == ["T20", "T19", "BULL"]
    assert suggest(40, 2, True) == ["D20"]
    assert suggest(32, 1, True) == ["D16"]
    assert suggest(36, 1, True) == ["D18"]

def test_bogey_and_too_high_return_none():
    for n in (169, 168, 166, 165, 163, 162, 159):
        assert suggest(n, 3, True) is None
    assert suggest(171, 3, True) is None

def test_respects_darts_left():
    # 170 needs 3 darts; with only 1 left there is no checkout
    assert suggest(170, 1, True) is None

def test_double_out_disabled_allows_single_finish():
    assert suggest(20, 1, False) == ["S20"]
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Implement** `src/granbridge/game/checkout.py`

```python
from __future__ import annotations

from typing import Optional

# Preferred routes for common finishes (double-out). Values are dart beds.
_PREFERRED: dict[int, list[str]] = {
    170: ["T20", "T20", "BULL"], 167: ["T20", "T19", "BULL"], 164: ["T20", "T18", "BULL"],
    161: ["T20", "T17", "BULL"], 160: ["T20", "T20", "D20"], 158: ["T20", "T20", "D19"],
    100: ["T20", "D20"], 81: ["T19", "D12"], 80: ["T20", "D10"], 50: ["BULL"],
    40: ["D20"], 36: ["D18"], 32: ["D16"], 24: ["D12"], 20: ["D10"], 4: ["D2"], 2: ["D1"],
}
_BOGEY = {169, 168, 166, 165, 163, 162, 159}

_TREBLES = {f"T{n}": 3 * n for n in range(1, 21)}
_SINGLES = {**{f"S{n}": n for n in range(1, 21)}, "S25": 25}
_FINISHERS = {**{f"D{n}": 2 * n for n in range(1, 21)}, "BULL": 50}  # BULL = double-bull finish


def suggest(remaining: int, darts_left: int, double_out: bool) -> Optional[list[str]]:
    """Suggest a checkout for `remaining` within `darts_left`. None if impossible/bogey."""
    if not double_out:
        if 1 <= remaining <= 20:
            return [f"S{remaining}"]
        route = _PREFERRED.get(remaining)
        return route if route and len(route) <= darts_left else None
    if remaining > 170 or remaining in _BOGEY or remaining < 2:
        return None
    route = _PREFERRED.get(remaining)
    if route is not None:
        return route if len(route) <= darts_left else None
    return _search(remaining, darts_left)


def _search(remaining: int, darts_left: int) -> Optional[list[str]]:
    setups = {**_TREBLES, **_SINGLES, **{f"D{n}": 2 * n for n in range(1, 21)}}
    for bed, val in _FINISHERS.items():            # 1 dart
        if val == remaining:
            return [bed]
    if darts_left < 2:
        return None
    for s_bed, s_val in setups.items():            # 2 darts
        for f_bed, f_val in _FINISHERS.items():
            if s_val + f_val == remaining:
                return [s_bed, f_bed]
    if darts_left < 3:
        return None
    for a_bed, a_val in setups.items():            # 3 darts
        for s_bed, s_val in setups.items():
            for f_bed, f_val in _FINISHERS.items():
                if a_val + s_val + f_val == remaining:
                    return [a_bed, s_bed, f_bed]
    return None
```

- [ ] **Step 4: Run PASS.** (`suggest(20,1,False)`→"S20"; `suggest(170,1,True)`→None since the preferred route needs 3 darts.)

---

## Tasks 6–9: Game modes (PARALLEL-SAFE after Task 5)

Each mode is its own file + test file, depends only on Tasks 1/4/5. Build in parallel.

### Task 6: X01 mode
**Files:** Create `src/granbridge/game/modes/x01.py`, `tests/game/modes/test_x01.py`.

- [ ] **Step 1: Failing test**

```python
from granbridge.game.models import Dart, GameState, Player
from granbridge.game.modes.x01 import X01Mode

def _state(opts):
    gs = GameState(mode="x01", players=[Player(id="p1", name="A"), Player(id="p2", name="B")])
    X01Mode().on_start(gs, opts)
    return gs

def test_scores_subtract_from_start():
    gs = _state({"start_score": 501})
    r = X01Mode().apply_dart(gs, Dart.from_bed("T20"))
    assert r.points == 60 and gs.mode_view["scores"]["p1"] == 441

def test_double_out_win_on_double():
    gs = _state({"start_score": 40, "double_out": True})
    r = X01Mode().apply_dart(gs, Dart.from_bed("D20"))
    assert r.leg_won is True and r.winner == "p1" and gs.mode_view["scores"]["p1"] == 0

def test_single_finish_busts_with_double_out():
    gs = _state({"start_score": 40, "double_out": True})
    m = X01Mode()
    assert m.apply_dart(gs, Dart.from_bed("S20")).busted is False  # 40 -> 20
    assert m.apply_dart(gs, Dart.from_bed("S20")).busted is True   # 20 -> 0 on a single = bust

def test_overshoot_busts():
    gs = _state({"start_score": 20, "double_out": True})
    assert X01Mode().apply_dart(gs, Dart.from_bed("T20")).busted is True

def test_leave_one_busts_on_double_out():
    gs = _state({"start_score": 20, "double_out": True})
    assert X01Mode().apply_dart(gs, Dart.from_bed("S19")).busted is True

def test_double_in_gates_scoring():
    gs = _state({"start_score": 501, "double_in": True})
    m = X01Mode()
    assert m.apply_dart(gs, Dart.from_bed("S20")).points == 0 and gs.mode_view["scores"]["p1"] == 501
    m.apply_dart(gs, Dart.from_bed("D20"))
    assert gs.mode_view["scores"]["p1"] == 461

def test_checkout_hint_present_when_in_range():
    gs = _state({"start_score": 40, "double_out": True})
    assert X01Mode().checkout_hint(gs) == ["D20"]
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Implement** `src/granbridge/game/modes/x01.py`

```python
from __future__ import annotations

from typing import Any, Optional

from granbridge.game.checkout import suggest
from granbridge.game.models import Dart, GameState
from granbridge.game.modes.base import DartResult, GameMode


class X01Mode(GameMode):
    name = "x01"

    def on_start(self, state: GameState, options: dict) -> None:
        start = int(options.get("start_score", 501))
        state.options = {**state.options, **options}
        state.mode_view = {
            "scores": {p.id: start for p in state.players},
            "opened": {p.id: not options.get("double_in", False) for p in state.players},
            "start_score": start,
            "checkout": None,
        }

    def apply_dart(self, state: GameState, dart: Dart) -> DartResult:
        pid = state.active_player_id
        scores = state.mode_view["scores"]
        opened = state.mode_view["opened"]
        double_out = bool(state.options.get("double_out", True))

        if not opened[pid]:
            if dart.multiplier == 2:
                opened[pid] = True
            else:
                return DartResult(points=0)

        remaining = scores[pid] - dart.score
        if remaining < 0 or (double_out and remaining == 1):
            return DartResult(points=0, busted=True)
        if remaining == 0:
            if double_out and dart.multiplier != 2:
                return DartResult(points=0, busted=True)
            scores[pid] = 0
            return DartResult(points=dart.score, leg_won=True, winner=pid)
        scores[pid] = remaining
        return DartResult(points=dart.score)

    def checkout_hint(self, state: GameState) -> Optional[list[str]]:
        pid = state.active_player_id
        if pid is None:
            return None
        remaining = state.mode_view["scores"][pid]
        darts_left = 3 - len(state.visit)
        return suggest(remaining, darts_left, bool(state.options.get("double_out", True)))

    def mode_view(self, state: GameState) -> dict[str, Any]:
        view = dict(state.mode_view)
        view["checkout"] = self.checkout_hint(state)
        return view
```

- [ ] **Step 4: Run PASS.** Bust paths return before mutating `scores`, so the engine's snapshot-revert fully restores state.

### Task 7: Cricket mode
**Files:** Create `src/granbridge/game/modes/cricket.py`, `tests/game/modes/test_cricket.py`.

- [ ] **Step 1: Failing test**

```python
from granbridge.game.models import Dart, GameState, Player
from granbridge.game.modes.cricket import CricketMode

def _state():
    gs = GameState(mode="cricket", players=[Player(id="p1", name="A"), Player(id="p2", name="B")])
    CricketMode().on_start(gs, {})
    return gs

def test_three_singles_close_number():
    gs = _state(); m = CricketMode()
    for _ in range(3):
        m.apply_dart(gs, Dart.from_bed("S20"))
    assert gs.mode_view["marks"]["p1"]["20"] == 3

def test_treble_gives_three_marks():
    gs = _state()
    CricketMode().apply_dart(gs, Dart.from_bed("T20"))
    assert gs.mode_view["marks"]["p1"]["20"] == 3

def test_points_scored_when_open_and_opponent_not_closed():
    gs = _state(); m = CricketMode()
    m.apply_dart(gs, Dart.from_bed("T20"))   # closes 20
    m.apply_dart(gs, Dart.from_bed("T20"))   # 3 extra marks -> 60 points
    assert gs.mode_view["points"]["p1"] == 60

def test_non_cricket_number_ignored():
    gs = _state()
    r = CricketMode().apply_dart(gs, Dart.from_bed("S5"))
    assert r.points == 0 and gs.mode_view["marks"]["p1"].get("5", 0) == 0

def test_win_all_closed_and_points_ahead():
    gs = _state(); m = CricketMode()
    for num in ["20", "19", "18", "17", "16", "15"]:
        for _ in range(3):
            m.apply_dart(gs, Dart.from_bed(f"S{num}"))
    m.apply_dart(gs, Dart.from_bed("BULL"))
    m.apply_dart(gs, Dart.from_bed("BULL"))
    last = m.apply_dart(gs, Dart.from_bed("BULL"))  # 3rd bull mark closes bull; opponent at 0
    assert gs.mode_view["marks"]["p1"]["B"] == 3 and last.leg_won is True and last.winner == "p1"
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Implement** `src/granbridge/game/modes/cricket.py`

```python
from __future__ import annotations

from typing import Any, Optional

from granbridge.game.models import Dart, GameState
from granbridge.game.modes.base import DartResult, GameMode

_NUMBERS = ["20", "19", "18", "17", "16", "15", "B"]  # B = bull


def _key(dart: Dart) -> Optional[str]:
    if dart.bed in ("BULL", "DBULL"):
        return "B"
    if dart.segment is not None and 15 <= dart.segment <= 20:
        return str(dart.segment)
    return None


def _marks_for(dart: Dart) -> int:
    if dart.bed == "DBULL":
        return 2
    if dart.bed == "BULL":
        return 1
    return dart.multiplier  # S/D/T -> 1/2/3


class CricketMode(GameMode):
    name = "cricket"

    def on_start(self, state: GameState, options: dict) -> None:
        state.options = {**state.options, **options}
        state.mode_view = {
            "numbers": _NUMBERS,
            "marks": {p.id: {n: 0 for n in _NUMBERS} for p in state.players},
            "points": {p.id: 0 for p in state.players},
        }

    def apply_dart(self, state: GameState, dart: Dart) -> DartResult:
        pid = state.active_player_id
        key = _key(dart)
        if key is None:
            return DartResult(points=0)
        marks = state.mode_view["marks"]
        points = state.mode_view["points"]
        scored = 0
        per_point = 25 if key == "B" else int(key)
        for _ in range(_marks_for(dart)):
            if marks[pid][key] < 3:
                marks[pid][key] += 1
            elif any(marks[o][key] < 3 for o in marks if o != pid):
                points[pid] += per_point
                scored += per_point
        if self._won(state, pid):
            return DartResult(points=scored, leg_won=True, winner=pid)
        return DartResult(points=scored)

    def _won(self, state: GameState, pid: str) -> bool:
        marks = state.mode_view["marks"]
        points = state.mode_view["points"]
        all_closed = all(marks[pid][n] >= 3 for n in _NUMBERS)
        ahead = all(points[pid] >= points[o] for o in points if o != pid)
        return all_closed and ahead

    def mode_view(self, state: GameState) -> dict[str, Any]:
        return dict(state.mode_view)
```

- [ ] **Step 4: Run PASS.**

### Task 8: Around-the-Clock mode
**Files:** Create `src/granbridge/game/modes/around_the_clock.py`, `tests/game/modes/test_around_the_clock.py`.

- [ ] **Step 1: Failing test**

```python
from granbridge.game.models import Dart, GameState, Player
from granbridge.game.modes.around_the_clock import AroundTheClockMode

def _state(opts=None):
    gs = GameState(mode="around_the_clock", players=[Player(id="p1", name="A")])
    AroundTheClockMode().on_start(gs, opts or {})
    return gs

def test_advances_on_correct_target():
    gs = _state(); m = AroundTheClockMode()
    assert gs.mode_view["target"]["p1"] == 1
    m.apply_dart(gs, Dart.from_bed("S1"))
    assert gs.mode_view["target"]["p1"] == 2

def test_wrong_target_no_advance():
    gs = _state()
    AroundTheClockMode().apply_dart(gs, Dart.from_bed("S5"))
    assert gs.mode_view["target"]["p1"] == 1

def test_singles_mode_rejects_double():
    gs = _state({"targets": "singles"})
    AroundTheClockMode().apply_dart(gs, Dart.from_bed("D1"))
    assert gs.mode_view["target"]["p1"] == 1

def test_any_mode_accepts_treble():
    gs = _state({"targets": "any"})
    AroundTheClockMode().apply_dart(gs, Dart.from_bed("T1"))
    assert gs.mode_view["target"]["p1"] == 2

def test_finishing_bull_wins():
    gs = _state({"include_bull": True}); m = AroundTheClockMode()
    gs.mode_view["target"]["p1"] = 21  # bull stage
    r = m.apply_dart(gs, Dart.from_bed("BULL"))
    assert r.leg_won is True and r.winner == "p1"
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Implement** `src/granbridge/game/modes/around_the_clock.py`

```python
from __future__ import annotations

from typing import Any

from granbridge.game.models import Dart, GameState
from granbridge.game.modes.base import DartResult, GameMode

_BULL_STAGE = 21


class AroundTheClockMode(GameMode):
    name = "around_the_clock"

    def on_start(self, state: GameState, options: dict) -> None:
        state.options = {**state.options, **options}
        state.mode_view = {
            "target": {p.id: 1 for p in state.players},
            "targets": options.get("targets", "any"),
            "include_bull": bool(options.get("include_bull", True)),
        }

    def apply_dart(self, state: GameState, dart: Dart) -> DartResult:
        pid = state.active_player_id
        target = state.mode_view["target"][pid]
        singles_only = state.mode_view["targets"] == "singles"

        if target == _BULL_STAGE:
            if dart.bed in ("BULL", "DBULL"):
                state.mode_view["target"][pid] = 22
                return DartResult(points=1, leg_won=True, winner=pid)
            return DartResult(points=0)

        hit = dart.segment == target and (not singles_only or dart.multiplier == 1)
        if not hit:
            return DartResult(points=0)
        nxt = target + 1
        if nxt > 20:
            if state.mode_view["include_bull"]:
                state.mode_view["target"][pid] = _BULL_STAGE
                return DartResult(points=1)
            state.mode_view["target"][pid] = 22
            return DartResult(points=1, leg_won=True, winner=pid)
        state.mode_view["target"][pid] = nxt
        return DartResult(points=1)

    def mode_view(self, state: GameState) -> dict[str, Any]:
        return dict(state.mode_view)
```

- [ ] **Step 4: Run PASS.**

### Task 9: Free-play mode
**Files:** Create `src/granbridge/game/modes/free_play.py`, `tests/game/modes/test_free_play.py`.

- [ ] **Step 1: Failing test**

```python
from granbridge.game.models import Dart, GameState, Player
from granbridge.game.modes.free_play import FreePlayMode

def _state():
    gs = GameState(mode="free_play", players=[Player(id="p1", name="A")])
    FreePlayMode().on_start(gs, {})
    return gs

def test_accumulates_total_and_hits():
    gs = _state(); m = FreePlayMode()
    m.apply_dart(gs, Dart.from_bed("T20"))
    m.apply_dart(gs, Dart.from_bed("T20"))
    assert gs.mode_view["total"]["p1"] == 120
    assert gs.mode_view["hits"]["p1"]["T20"] == 2

def test_never_wins():
    gs = _state()
    r = FreePlayMode().apply_dart(gs, Dart.from_bed("BULL"))
    assert r.leg_won is False and r.winner is None
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Implement** `src/granbridge/game/modes/free_play.py`

```python
from __future__ import annotations

from typing import Any

from granbridge.game.models import Dart, GameState
from granbridge.game.modes.base import DartResult, GameMode


class FreePlayMode(GameMode):
    name = "free_play"

    def on_start(self, state: GameState, options: dict) -> None:
        state.options = {**state.options, **options}
        state.mode_view = {
            "total": {p.id: 0 for p in state.players},
            "hits": {p.id: {} for p in state.players},
        }

    def apply_dart(self, state: GameState, dart: Dart) -> DartResult:
        pid = state.active_player_id
        state.mode_view["total"][pid] += dart.score
        hits = state.mode_view["hits"][pid]
        hits[dart.bed] = hits.get(dart.bed, 0) + 1
        return DartResult(points=dart.score)

    def mode_view(self, state: GameState) -> dict[str, Any]:
        return dict(state.mode_view)
```

- [ ] **Step 4: Run PASS.**

---

## Task 10: GameEngine

**Files:** Create `src/granbridge/game/engine.py`, `tests/game/test_engine.py`.

The engine holds `GameState`, a mode registry, a bounded snapshot undo stack, and a start-of-visit snapshot. It consumes `dart_hit` events from the bus; routes to the active mode; owns turn flow (3-dart visit, auto-advance, manual next, miss), bust-revert, match structure (`best_of_legs`), command handling, and event publication. Mutations are synchronous; events are queued in `_pending` and flushed to the bus by `attach()` / the caller.

- [ ] **Step 1: Write failing tests** (`tests/game/test_engine.py`)

```python
from granbridge.core.bus import EventBus
from granbridge.game.engine import GameEngine
from granbridge.game.commands import StartGame, NextPlayer, Undo, RecordMiss, CorrectLast
from granbridge.game.models import Dart

def _engine():
    return GameEngine(EventBus())

def _start(eng, **opts):
    eng.handle_command(StartGame(command="start_game", mode=opts.pop("mode", "x01"),
                                 players=opts.pop("players", ["A"]), options=opts))

def test_start_game_in_progress():
    eng = _engine(); _start(eng, start_score=501)
    assert eng.state.status.value == "in_progress"
    assert eng.state.mode_view["scores"]["p1"] == 501

def test_dart_scores_active_player():
    eng = _engine(); _start(eng, start_score=501)
    eng.on_dart(Dart.from_bed("T20"))
    assert eng.state.mode_view["scores"]["p1"] == 441

def test_auto_advance_after_three_darts():
    eng = _engine(); _start(eng, players=["A", "B"], start_score=501)
    for _ in range(3):
        eng.on_dart(Dart.from_bed("S1"))
    assert eng.state.active_index == 1 and eng.state.visit == []

def test_record_miss_counts_as_dart():
    eng = _engine(); _start(eng, players=["A", "B"], start_score=501)
    eng.handle_command(RecordMiss(command="record_miss"))
    assert len(eng.state.visit) == 1

def test_next_player_advances_early():
    eng = _engine(); _start(eng, players=["A", "B"], start_score=501)
    eng.on_dart(Dart.from_bed("S5"))
    eng.handle_command(NextPlayer(command="next_player"))
    assert eng.state.active_index == 1 and eng.state.visit == []

def test_undo_restores_previous():
    eng = _engine(); _start(eng, start_score=501)
    eng.on_dart(Dart.from_bed("T20"))
    eng.handle_command(Undo(command="undo"))
    assert eng.state.mode_view["scores"]["p1"] == 501 and eng.state.visit == []

def test_correct_last_replaces_dart():
    eng = _engine(); _start(eng, start_score=501)
    eng.on_dart(Dart.from_bed("S20"))   # misread
    eng.handle_command(CorrectLast(command="correct_last", bed="T20"))
    assert eng.state.mode_view["scores"]["p1"] == 441

def test_bust_reverts_visit_and_advances():
    eng = _engine(); _start(eng, players=["A", "B"], start_score=50, double_out=True)
    eng.on_dart(Dart.from_bed("S10"))   # 40
    eng.on_dart(Dart.from_bed("T20"))   # -20 -> bust
    assert eng.state.mode_view["scores"]["p1"] == 50 and eng.state.active_index == 1

def test_dart_without_game_queues_command_error():
    eng = _engine()
    eng.on_dart(Dart.from_bed("T20"))
    assert any(getattr(e, "category", None) == "command" for e in eng._pending)

def test_game_won_emitted_on_finish():
    eng = _engine(); _start(eng, start_score=40, double_out=True, best_of_legs=1)
    eng.on_dart(Dart.from_bed("D20"))
    assert eng.state.status.value == "finished" and eng.state.winner == "p1"
    assert any(e.type == "game_won" for e in eng._pending)
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Implement** `src/granbridge/game/engine.py`

```python
from __future__ import annotations

from typing import Optional

import structlog

from granbridge.core.bus import EventBus
from granbridge.events.models import DartHit, ErrorEvent
from granbridge.game.commands import (
    Command, CorrectLast, EndGame, NextPlayer, RecordMiss, StartGame, Undo,
)
from granbridge.game.events import Bust, GameStarted, GameStateEvent, GameWon, LegWon
from granbridge.game.models import Dart, GameState, GameStatus, Player, PlayerStats
from granbridge.game.modes.around_the_clock import AroundTheClockMode
from granbridge.game.modes.base import GameMode
from granbridge.game.modes.cricket import CricketMode
from granbridge.game.modes.free_play import FreePlayMode
from granbridge.game.modes.x01 import X01Mode

log = structlog.get_logger(__name__)

_REGISTRY: dict[str, type[GameMode]] = {
    "x01": X01Mode, "cricket": CricketMode,
    "around_the_clock": AroundTheClockMode, "free_play": FreePlayMode,
}
_UNDO_LIMIT = 60


class GameEngine:
    """Owns game state, turn flow, snapshot undo, and command handling."""

    def __init__(self, bus: EventBus) -> None:
        self._bus = bus
        self._mode: Optional[GameMode] = None
        self.state = GameState(mode="none")
        self._undo: list[tuple[GameState, Optional[GameState]]] = []
        self._visit_start: Optional[GameState] = None
        self._pending: list = []

    # ---- bus integration ----
    async def attach(self) -> None:
        with self._bus.subscribe() as sub:
            while True:
                event = await sub.get()
                if isinstance(event, DartHit) and self.state.status == GameStatus.IN_PROGRESS:
                    self.on_dart(Dart(bed=event.bed, ring=str(event.ring), segment=event.segment,
                                      multiplier=event.multiplier, score=event.score))
                    await self._flush()

    async def _flush(self) -> None:
        for ev in self._pending:
            await self._bus.publish(ev)
        self._pending.clear()

    def _emit(self, ev) -> None:
        self._pending.append(ev)

    def _emit_state(self) -> None:
        if self._mode is not None:
            self.state.mode_view = self._mode.mode_view(self.state)
        self._emit(GameStateEvent(state=self.state.model_copy(deep=True)))

    # ---- commands ----
    def handle_command(self, cmd: Command) -> None:
        if isinstance(cmd, StartGame):
            self._start(cmd)
        elif isinstance(cmd, NextPlayer):
            self._guard(self._advance)
        elif isinstance(cmd, RecordMiss):
            self._guard(lambda: self.on_dart(Dart.from_bed("MISS")))
        elif isinstance(cmd, Undo):
            self._undo_last()
        elif isinstance(cmd, CorrectLast):
            self._correct_last(cmd.bed)
        elif isinstance(cmd, EndGame):
            self.state.status = GameStatus.WAITING
            self._emit_state()

    def _guard(self, fn) -> None:
        if self.state.status != GameStatus.IN_PROGRESS:
            self._emit(ErrorEvent(category="command", message="no game in progress"))
            return
        fn()

    def _start(self, cmd: StartGame) -> None:
        mode_cls = _REGISTRY.get(cmd.mode)
        if mode_cls is None:
            self._emit(ErrorEvent(category="command", message=f"unknown mode {cmd.mode!r}"))
            return
        self._mode = mode_cls()
        players = [Player(id=f"p{i+1}", name=n) for i, n in enumerate(cmd.players)] or [Player(id="p1", name="P1")]
        self.state = GameState(mode=cmd.mode, status=GameStatus.IN_PROGRESS, players=players,
                               options=dict(cmd.options))
        self.state.legs = {p.id: 0 for p in players}
        self.state.sets = {p.id: 0 for p in players}
        self.state.stats = {p.id: PlayerStats() for p in players}
        self._mode.on_start(self.state, cmd.options)
        self._undo.clear()
        self._snapshot_visit_start()
        self._emit(GameStarted(mode=cmd.mode, players=players, options=dict(cmd.options)))
        self._emit_state()

    # ---- dart handling ----
    def on_dart(self, dart: Dart) -> None:
        if self.state.status != GameStatus.IN_PROGRESS or self._mode is None:
            self._emit(ErrorEvent(category="command", message="dart with no game in progress"))
            return
        self._push_undo()
        pid = self.state.active_player_id
        result = self._mode.apply_dart(self.state, dart)
        self.state.visit.append(dart)
        stats = self.state.stats[pid]
        stats.darts += 1
        stats.total_scored += result.points

        if result.busted:
            self._emit(Bust(player=pid, score_attempted=dart.score, reason="bust"))
            self._restore_visit_start()
            self._advance()
            return
        if result.leg_won:
            self._on_leg_won(pid)
            return
        if len(self.state.visit) >= 3:
            self._advance()
        else:
            self._emit_state()

    def _on_leg_won(self, pid: str) -> None:
        self.state.legs[pid] += 1
        best_of = int(self.state.options.get("best_of_legs", 1))
        needed = best_of // 2 + 1
        self._emit(LegWon(player=pid, legs=self.state.legs[pid], sets=self.state.sets[pid]))
        if self.state.legs[pid] >= needed:
            self.state.status = GameStatus.FINISHED
            self.state.winner = pid
            self._emit(GameWon(player=pid))
            self._emit_state()
            return
        idx = next(i for i, p in enumerate(self.state.players) if p.id == pid)
        self.state.active_index = (idx + 1) % len(self.state.players)
        self.state.visit = []
        self._mode.on_start(self.state, self.state.options)
        self._snapshot_visit_start()
        self._emit_state()

    def _advance(self) -> None:
        self.state.active_index = (self.state.active_index + 1) % len(self.state.players)
        self.state.visit = []
        self._snapshot_visit_start()
        self._emit_state()

    # ---- undo / snapshots ----
    def _push_undo(self) -> None:
        self._undo.append((self.state.model_copy(deep=True),
                           self._visit_start.model_copy(deep=True) if self._visit_start else None))
        if len(self._undo) > _UNDO_LIMIT:
            self._undo.pop(0)

    def _undo_last(self) -> None:
        if not self._undo:
            return
        self.state, self._visit_start = self._undo.pop()
        if self.state.mode in _REGISTRY:
            self._mode = _REGISTRY[self.state.mode]()
        self._emit_state()

    def _correct_last(self, bed: str) -> None:
        if not self._undo:
            return
        self._undo_last()
        self.on_dart(Dart.from_bed(bed))

    def _snapshot_visit_start(self) -> None:
        self._visit_start = self.state.model_copy(deep=True)

    def _restore_visit_start(self) -> None:
        if self._visit_start is None:
            return
        keep_legs = dict(self.state.legs)
        keep_stats = {k: v.model_copy(deep=True) for k, v in self.state.stats.items()}
        self.state = self._visit_start.model_copy(deep=True)
        self.state.legs = keep_legs
        self.state.stats = keep_stats
```

- [ ] **Step 4: Run PASS.** Note on `test_correct_last_replaces_dart`: `_undo_last` restores the pre-misread snapshot (visit empty, 501), then `on_dart("T20")` re-applies → 441.

---

## Task 11: WebSocket inbound commands

**Files:** Modify `src/granbridge/api/ws_server.py`; Test `tests/api/test_ws_commands.py`.

The server gains an optional `command_handler: Callable[[dict], None]`. `_handle` runs an outbound pump (bus → client) and an inbound pump (client → handler) concurrently.

- [ ] **Step 1: Write failing test**

```python
import asyncio, json, pytest, websockets
from granbridge.core.bus import EventBus
from granbridge.api.ws_server import WebSocketServer

async def test_inbound_command_routed():
    bus = EventBus()
    received = []
    server = WebSocketServer(bus, "127.0.0.1", 8801, command_handler=received.append)
    await server.start()
    try:
        async with websockets.connect("ws://127.0.0.1:8801") as ws:
            await ws.send(json.dumps({"command": "next_player"}))
            await asyncio.sleep(0.1)
        assert received and received[0]["command"] == "next_player"
    finally:
        await server.stop()
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Modify `src/granbridge/api/ws_server.py`** — full new version:

```python
from __future__ import annotations

import asyncio
import json
from typing import Callable, Optional

import structlog
from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from granbridge.core.bus import EventBus

log = structlog.get_logger(__name__)


class WebSocketServer:
    """Broadcasts bus events as JSON (snapshot first), and optionally routes
    inbound JSON commands to `command_handler`."""

    def __init__(self, bus: EventBus, host: str, port: int,
                 command_handler: Optional[Callable[[dict], None]] = None) -> None:
        self._bus = bus
        self._host = host
        self._port = port
        self._command_handler = command_handler
        self._server: Optional[Server] = None

    async def start(self) -> None:
        self._server = await serve(self._handle, self._host, self._port)
        log.info("ws_server.started", host=self._host, port=self._port)

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    async def _handle(self, ws: ServerConnection) -> None:
        for event in self._bus.snapshot():
            await ws.send(event.model_dump_json())
        with self._bus.subscribe() as sub:
            outbound = asyncio.ensure_future(self._pump_out(ws, sub))
            inbound = asyncio.ensure_future(self._pump_in(ws))
            try:
                await asyncio.wait({outbound, inbound}, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for t in (outbound, inbound):
                    t.cancel()

    async def _pump_out(self, ws: ServerConnection, sub) -> None:
        try:
            while True:
                event = await sub.get()
                await ws.send(event.model_dump_json())
        except ConnectionClosed:
            return

    async def _pump_in(self, ws: ServerConnection) -> None:
        try:
            async for raw in ws:
                if self._command_handler is None:
                    continue
                try:
                    self._command_handler(json.loads(raw))
                except Exception as exc:  # noqa: BLE001 - report, don't crash the socket
                    log.warning("ws.bad_command", error=str(exc))
        except ConnectionClosed:
            return
```

- [ ] **Step 4: Run** `pytest tests/api -v` → new test + existing `test_ws_server.py` both pass.

---

## Task 12: Wire engine into `serve`

**Files:** Modify `src/granbridge/cli.py`; Test `tests/game/test_wiring.py`.

- [ ] **Step 1: Write test** `tests/game/test_wiring.py`

```python
from granbridge.core.bus import EventBus
from granbridge.game.engine import GameEngine
from granbridge.game.commands import parse_command

def test_command_handler_parses_and_dispatches():
    eng = GameEngine(EventBus())
    handler = lambda payload: eng.handle_command(parse_command(payload))
    handler({"command": "start_game", "mode": "free_play", "players": ["A"], "options": {}})
    assert eng.state.status.value == "in_progress" and eng.state.mode == "free_play"
```

- [ ] **Step 2: Run** (PASS once engine exists).

- [ ] **Step 3: Modify `cli.py` `serve`** — replace the body of the inner `_run()` with:

```python
    async def _run() -> None:
        bus = EventBus()
        segment_map = SegmentMap.load(settings.overrides_path)
        engine = GameEngine(bus)

        def command_handler(payload: dict) -> None:
            from granbridge.game.commands import parse_command
            try:
                engine.handle_command(parse_command(payload))
            except Exception:
                pass
            asyncio.create_task(engine._flush())

        mgr = ConnectionManager(
            transport=BleakTransport(), bus=bus,
            name_prefix=settings.board_name_prefix, service_uuid=settings.vendor_service_uuid,
            backoff_base=settings.backoff_base, backoff_cap=settings.backoff_cap,
            heartbeat_timeout=settings.heartbeat_timeout, segment_map=segment_map,
        )
        server = WebSocketServer(bus, settings.ws_host, settings.ws_port, command_handler=command_handler)
        await server.start()
        typer.echo(f"Serving on ws://{settings.ws_host}:{settings.ws_port}")
        await asyncio.gather(mgr.run(), engine.attach())
```
Add import: `from granbridge.game.engine import GameEngine`.

- [ ] **Step 4: Run** `pytest -q` → all pass; `python -c "import granbridge.cli"` clean.

---

## Task 13: Minimal game overlay (safe DOM — no innerHTML)

**Files:** Create `src/granbridge/overlay/game.html`; Test `tests/test_game_overlay_asset.py`.

- [ ] **Step 1: Failing test**

```python
from pathlib import Path
def test_game_overlay_consumes_game_state():
    html = Path("src/granbridge/overlay/game.html").read_text()
    assert "game_state" in html and "8787" in html and "checkout" in html and "WebSocket" in html
    assert "innerHTML" not in html  # safe DOM construction only
```

- [ ] **Step 2: Run FAIL.**

- [ ] **Step 3: Implement** `src/granbridge/overlay/game.html` (uses `createElement`/`textContent`/`replaceChildren`)

```html
<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>GRANBRIDGE Game</title>
<style>
 html,body{margin:0;background:transparent;font-family:system-ui,sans-serif;color:#fff}
 #board{position:fixed;bottom:24px;left:24px;display:flex;gap:24px}
 .player{padding:12px 20px;border-radius:12px;background:rgba(0,0,0,.55);min-width:140px}
 .player.active{outline:3px solid #ffd54a}
 .name{font-size:20px;opacity:.85}.score{font-size:64px;font-weight:800}
 #checkout{position:fixed;bottom:24px;right:24px;font-size:28px;background:rgba(0,0,0,.55);padding:10px 16px;border-radius:12px}
 #status{position:fixed;top:8px;right:12px;font-size:13px;opacity:.6}
</style></head><body>
<div id="status">connecting…</div><div id="board"></div><div id="checkout"></div>
<script>
const PORT=8787;
const boardEl=document.getElementById("board");
const coEl=document.getElementById("checkout");
const stEl=document.getElementById("status");
function makePlayer(p,active,score){
  const d=document.createElement("div");
  d.className="player"+(active?" active":"");
  const name=document.createElement("div");name.className="name";name.textContent=p.name;
  const sc=document.createElement("div");sc.className="score";
  sc.textContent=(score===undefined||score===null)?"":String(score);
  d.append(name,sc);return d;
}
function render(state){
  const scores=(state.mode_view&&state.mode_view.scores)||{};
  const nodes=state.players.map((p,i)=>makePlayer(p,i===state.active_index,scores[p.id]));
  boardEl.replaceChildren(...nodes);
  const co=state.mode_view&&state.mode_view.checkout;
  coEl.textContent=co?("OUT: "+co.join("  ")):"";
}
function connect(){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.onopen=()=>stEl.textContent="connected";
  ws.onclose=()=>{stEl.textContent="reconnecting…";setTimeout(connect,1000);};
  ws.onmessage=(m)=>{const ev=JSON.parse(m.data);
    if(ev.type==="game_state")render(ev.state);
    if(ev.type==="game_won")coEl.textContent="🏆 "+ev.player+" wins";};
}
connect();
</script></body></html>
```

- [ ] **Step 4: Run PASS.**

---

## Task 14: End-to-end game integration test

**Files:** Create `tests/integration/test_game_e2e.py`.

- [ ] **Step 1: Write the test** — drive an X01 micro-leg through the engine and assert `game_won` reaches the bus:

```python
import asyncio, pytest
from granbridge.core.bus import EventBus
from granbridge.game.engine import GameEngine
from granbridge.game.commands import StartGame
from granbridge.game.models import Dart

async def test_x01_micro_leg_to_game_won():
    bus = EventBus()
    eng = GameEngine(bus)
    seen = []
    async def collect():
        with bus.subscribe() as sub:
            while True:
                seen.append(await sub.get())
    task = asyncio.create_task(collect())
    await asyncio.sleep(0)
    eng.handle_command(StartGame(command="start_game", mode="x01", players=["A"],
                                 options={"start_score": 60, "double_out": True, "best_of_legs": 1}))
    await eng._flush()
    eng.on_dart(Dart.from_bed("S20")); await eng._flush()   # 60 -> 40
    eng.on_dart(Dart.from_bed("D20")); await eng._flush()   # 40 -> 0 on a double -> win
    await asyncio.sleep(0.05)
    task.cancel()
    assert any(e.type == "game_won" for e in seen)
```

- [ ] **Step 2: Run** `pytest tests/integration/test_game_e2e.py -v` → PASS.

- [ ] **Step 3: Full suite** `pytest -q` → all green.

---

## Self-Review

- **Spec coverage:** start over WS (T3/T11/T12), per-mode scoring (T6–T9), turn model incl. auto/manual/miss (T10), `game_state` + transition events (T2/T10), undo & correct_last (T10), X01 checkout (T5/T6/T13), Cricket marks/points/win (T7), practice ATC + Free-play (T8/T9), bidirectional WS (T11), no-rework integration (T12). All success criteria mapped.
- **Placeholder scan:** none; every code step has complete code. The async-engine test reconciled to the synchronous `_pending` reality in T10.
- **Type consistency:** `GameMode.on_start/apply_dart/mode_view/checkout_hint`, `DartResult{points,busted,leg_won,winner}`, `GameState` fields, `Dart.from_bed`, command models, and event models referenced consistently. `_REGISTRY` keys match `StartGame.mode` values and the `_REGISTRY` used by undo to rebuild the mode.
- **Security:** overlay uses safe DOM construction (no `innerHTML`); inbound WS commands are validated via pydantic and never executed as code.
- **Parallelism:** Tasks 6–9 are disjoint files depending only on 1/4/5 → safe to build concurrently; 10–14 serial (shared engine/ws/cli + full-suite/e2e).
```
