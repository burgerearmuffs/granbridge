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
