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
