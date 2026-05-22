"""Regression tests for the live attach() path and multi-leg starter rotation.

These cover gaps the final review found: the engine's bus-driven attach() path
was never exercised (M1: ring serialized as 'Ring.TRIPLE'), and leg-starter
alternation was derived from the winner instead of the starter (M2)."""
import asyncio

from granbridge.core.bus import EventBus
from granbridge.events.models import DartHit, Ring
from granbridge.game.commands import StartGame
from granbridge.game.engine import GameEngine
from granbridge.game.models import Dart


async def test_attach_decodes_real_darthit_with_clean_ring_value():
    bus = EventBus()
    eng = GameEngine(bus)
    eng.handle_command(StartGame(command="start_game", mode="x01", players=["A"],
                                 options={"start_score": 501}))
    await eng._flush()
    task = asyncio.create_task(eng.attach())
    await asyncio.sleep(0)
    await bus.publish(DartHit(raw="T20@", ring=Ring.TRIPLE, segment=20, multiplier=3, bed="T20", score=60))
    await asyncio.sleep(0.05)
    task.cancel()
    pid = eng.state.players[0].id
    assert eng.state.mode_view["scores"][pid] == 441
    # ring must be the enum VALUE "T", not "Ring.TRIPLE"
    assert eng.state.visit and eng.state.visit[0].ring == "T"


def test_leg_starter_alternates_by_starter_not_winner():
    bus = EventBus()
    eng = GameEngine(bus)
    eng.handle_command(StartGame(command="start_game", mode="x01", players=["A", "B"],
                                 options={"start_score": 40, "double_out": True, "best_of_legs": 3}))
    # leg 1 starts with p1 (index 0)
    assert eng.state.active_index == 0 and eng.state.leg_starter_index == 0
    # p1 throws 3 misses -> advance to p2
    for _ in range(3):
        eng.on_dart(Dart.from_bed("MISS"))
    assert eng.state.active_index == 1
    # p2 wins leg 1 on a double
    eng.on_dart(Dart.from_bed("D20"))
    # match not over (need 2 legs); leg 2 starter must alternate to p2 (index 1),
    # NOT back to p1 — independent of who won the leg.
    assert eng.state.leg_starter_index == 1 and eng.state.active_index == 1
    assert eng.state.legs[eng.state.players[1].id] == 1
