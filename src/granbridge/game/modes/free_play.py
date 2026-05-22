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
