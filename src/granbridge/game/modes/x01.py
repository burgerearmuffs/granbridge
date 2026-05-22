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
