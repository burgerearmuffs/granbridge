from __future__ import annotations

from typing import Optional

from granbridge.events.models import BaseEvent
from granbridge.game.models import GameStatus
from granbridge.history.store import HistoryStore
from granbridge.integrations.base import Plugin


class HistoryPlugin(Plugin):
    """Records game history to SQLite via HistoryStore."""

    name = "history"

    def __init__(self, config: dict, store: HistoryStore) -> None:
        super().__init__(config)
        self._store = store
        self._current_game_id: Optional[int] = None
        self._active_player: Optional[str] = None
        self._game_ended: bool = False
        # Map player id -> player name, set on game_started
        self._id_to_name: dict[str, str] = {}

    async def handle(self, event: BaseEvent) -> None:
        if event.type == "game_started":
            self._handle_game_started(event)
        elif event.type == "game_state":
            self._handle_game_state(event)
        elif event.type == "dart_hit":
            self._handle_dart_hit(event)

    def _handle_game_started(self, event: BaseEvent) -> None:
        # event has .mode, .players (list[Player]), .options
        players = event.players  # type: ignore[attr-defined]
        mode = event.mode  # type: ignore[attr-defined]
        options = event.options  # type: ignore[attr-defined]

        player_names = [p.name for p in players]
        self._id_to_name = {p.id: p.name for p in players}
        self._current_game_id = self._store.start_game(mode, player_names, options)
        self._game_ended = False
        # Set initial active player from the first player
        self._active_player = player_names[0] if player_names else None

    def _handle_game_state(self, event: BaseEvent) -> None:
        state = event.state  # type: ignore[attr-defined]
        # Update active player from the state
        if state.players and 0 <= state.active_index < len(state.players):
            self._active_player = state.players[state.active_index].name

        # Check if the game just finished
        if (
            self._current_game_id is not None
            and not self._game_ended
            and state.status == GameStatus.FINISHED
        ):
            winner_name: Optional[str] = None
            if state.winner is not None:
                # winner is a player id; resolve to name
                winner_name = self._id_to_name.get(state.winner, state.winner)
            self._store.end_game(self._current_game_id, winner_name)
            self._game_ended = True

    def _handle_dart_hit(self, event: BaseEvent) -> None:
        if self._current_game_id is None or self._active_player is None:
            return
        bed = event.bed  # type: ignore[attr-defined]
        score = event.score  # type: ignore[attr-defined]
        self._store.record_throw(self._current_game_id, self._active_player, bed, score)
