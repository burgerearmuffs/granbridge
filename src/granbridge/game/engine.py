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
