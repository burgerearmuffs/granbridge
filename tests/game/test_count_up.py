from granbridge.core.bus import EventBus
from granbridge.game.engine import GameEngine
from granbridge.game.commands import StartGame
from granbridge.game.models import Dart


def _engine():
    return GameEngine(EventBus())


def _start(eng, players, **opts):
    eng.handle_command(StartGame(command="start_game", mode="count_up", players=players, options=opts))


def _throw(eng, *beds):
    for b in beds:
        eng.on_dart(Dart.from_bed(b))


def test_scoring_accumulates():
    eng = _engine(); _start(eng, ["A"], rounds=8)
    _throw(eng, "T20", "T20", "T20")  # 180
    assert eng.state.mode_view["total"]["p1"] == 180


def test_bull_values_and_miss():
    eng = _engine(); _start(eng, ["A"], rounds=8)
    _throw(eng, "BULL", "DBULL", "MISS")  # 25 + 50 + 0
    assert eng.state.mode_view["total"]["p1"] == 75


def test_round_advances_after_three_darts():
    eng = _engine(); _start(eng, ["A"], rounds=8)
    assert eng.state.mode_view["current_round"] == 1
    _throw(eng, "S1", "S1", "S1")
    assert eng.state.mode_view["current_round"] == 2


def test_default_rounds_is_eight():
    eng = _engine(); _start(eng, ["A"])
    assert eng.state.mode_view["rounds"] == 8


def test_rounds_option_respected():
    eng = _engine(); _start(eng, ["A"], rounds=3)
    assert eng.state.mode_view["rounds"] == 3


def test_solo_game_ends_after_n_rounds():
    eng = _engine(); _start(eng, ["A"], rounds=2)
    _throw(eng, "S5", "S5", "S5")          # round 1
    assert eng.state.status.value == "in_progress"
    _throw(eng, "S5", "S5", "S5")          # round 2 -> ends
    assert eng.state.status.value == "finished"
    assert eng.state.winner == "p1"


def test_winner_is_highest_not_last_thrower():
    eng = _engine(); _start(eng, ["A", "B"], rounds=1)
    _throw(eng, "T20", "T20", "T20")       # p1: 180
    assert eng.state.active_index == 1
    _throw(eng, "S1", "S1", "S1")          # p2: 3, final dart -> ends
    assert eng.state.status.value == "finished"
    assert eng.state.winner == "p1"        # highest total wins though p2 threw last


def test_tie_goes_to_earlier_player():
    eng = _engine(); _start(eng, ["A", "B"], rounds=1)
    _throw(eng, "S5", "S5", "S5")          # p1: 15
    _throw(eng, "S5", "S5", "S5")          # p2: 15 (tie)
    assert eng.state.status.value == "finished"
    assert eng.state.winner == "p1"
