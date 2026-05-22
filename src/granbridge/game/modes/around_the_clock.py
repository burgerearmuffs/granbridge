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
