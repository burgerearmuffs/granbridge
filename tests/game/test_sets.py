"""Tests for X01 best_of_sets match structure (SP-E hardening #3)."""
from __future__ import annotations

import pytest

from granbridge.core.bus import EventBus
from granbridge.game.commands import StartGame
from granbridge.game.engine import GameEngine
from granbridge.game.models import Dart, GameStatus


def _engine_bo3_sets() -> GameEngine:
    """Return a started engine: start_score=40, double_out=True, best_of_legs=1, best_of_sets=3.

    With best_of_sets=3 the match is won by the first player to reach 2 sets.
    With best_of_legs=1 each set is won by the first player to win 1 leg.
    So winning a leg immediately wins a set, but the match requires 2 sets.
    """
    eng = GameEngine(EventBus())
    eng.handle_command(StartGame(
        command="start_game",
        mode="x01",
        players=["A", "B"],
        options={
            "start_score": 40,
            "double_out": True,
            "best_of_legs": 1,
            "best_of_sets": 3,
        },
    ))
    return eng


def test_winning_a_leg_increments_sets_and_resets_legs():
    """After p1 wins a leg in a best_of_sets=3 game their set count should be 1, legs reset to 0."""
    eng = _engine_bo3_sets()
    pid = "p1"

    # p1 is active first; D20 = 40 → checkout
    eng.on_dart(Dart.from_bed("D20"))

    assert eng.state.sets[pid] == 1, "p1 should have 1 set after winning the first leg"
    assert eng.state.legs[pid] == 0, "legs should reset to 0 after a set is won"
    assert eng.state.legs["p2"] == 0, "all legs should reset"
    assert eng.state.status == GameStatus.IN_PROGRESS, "match must NOT be finished after 1 of 2 needed sets"
    # No GameWon in pending
    assert not any(e.type == "game_won" for e in eng._pending), "GameWon must not be emitted yet"


def test_winning_second_set_ends_match():
    """After p1 wins 2 sets (= best_of_sets//2+1 with best_of_sets=3) the match is FINISHED."""
    eng = _engine_bo3_sets()
    pid = "p1"

    # Set 1: p1 wins with D20
    eng.on_dart(Dart.from_bed("D20"))
    assert eng.state.sets[pid] == 1
    assert eng.state.status == GameStatus.IN_PROGRESS

    # After the set, leg starter alternates. The new active player might not be p1.
    # Advance to p1's turn in the new leg: send 3 misses for p2 if needed.
    if eng.state.active_player_id != pid:
        # p2 is the new starter; throw 3 misses to pass to p1
        for _ in range(3):
            eng.on_dart(Dart.from_bed("MISS"))

    # p1 should now be active (after 3 p2 misses)
    assert eng.state.active_player_id == pid, (
        f"Expected p1 to be active, got {eng.state.active_player_id}"
    )

    # Set 2: p1 wins with D20 again
    eng.on_dart(Dart.from_bed("D20"))

    assert eng.state.sets[pid] == 2, f"p1 should have 2 sets, got {eng.state.sets[pid]}"
    assert eng.state.status == GameStatus.FINISHED, "Match must be FINISHED after 2 sets"
    assert eng.state.winner == pid
    assert any(e.type == "game_won" for e in eng._pending), "GameWon must be emitted"


def test_leg_won_emitted_per_leg():
    """LegWon events are emitted for each leg won, even in a sets game."""
    eng = _engine_bo3_sets()
    eng.on_dart(Dart.from_bed("D20"))

    leg_won_events = [e for e in eng._pending if e.type == "leg_won"]
    assert len(leg_won_events) >= 1, "LegWon must be emitted when a leg is won"


def test_backward_compat_default_best_of_sets():
    """With default best_of_sets=1, winning the legs threshold immediately ends the match."""
    eng = GameEngine(EventBus())
    eng.handle_command(StartGame(
        command="start_game",
        mode="x01",
        players=["A"],
        options={"start_score": 40, "double_out": True, "best_of_legs": 1},
        # best_of_sets defaults to 1
    ))
    eng.on_dart(Dart.from_bed("D20"))

    assert eng.state.status == GameStatus.FINISHED
    assert eng.state.winner == "p1"
    assert any(e.type == "game_won" for e in eng._pending)
