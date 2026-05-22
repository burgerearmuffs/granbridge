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
