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
