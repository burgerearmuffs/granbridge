from granbridge.core.bus import EventBus
from granbridge.game.engine import GameEngine
from granbridge.game.commands import StartGame, Undo
from granbridge.game.models import Dart


def _engine():
    return GameEngine(EventBus())


def _start(eng, players, **opts):
    eng.handle_command(StartGame(command="start_game", mode="medley", players=players, options=opts))


def _throw(eng, *beds):
    for b in beds:
        eng.on_dart(Dart.from_bed(b))


def test_default_sequence_and_first_leg():
    eng = _engine(); _start(eng, ["A"])
    m = eng.state.mode_view["medley"]
    assert m["sequence"] == ["x01", "cricket", "count_up"]
    assert m["index"] == 0 and m["current"] == "x01"
    assert int(eng.state.options["best_of_legs"]) == 3
    assert "scores" in eng.state.mode_view


def test_winning_a_leg_advances_the_sequence():
    eng = _engine(); _start(eng, ["A"], sequence=["count_up", "x01"], rounds=1)
    assert eng.state.mode_view["medley"]["current"] == "count_up"
    _throw(eng, "S5", "S5", "S5")            # leg 1 (count_up, 1 round) done
    assert eng.state.status.value == "in_progress"
    assert eng.state.mode_view["medley"]["current"] == "x01"
    assert eng.state.mode_view["medley"]["index"] == 1
    assert "scores" in eng.state.mode_view


def test_match_ends_after_majority_of_legs():
    eng = _engine(); _start(eng, ["A"], sequence=["count_up", "count_up"], rounds=1)
    _throw(eng, "S5", "S5", "S5")            # leg 1
    assert eng.state.status.value == "in_progress"
    _throw(eng, "S5", "S5", "S5")            # leg 2 -> majority (2) reached
    assert eng.state.status.value == "finished"
    assert eng.state.winner == "p1"


def test_unknown_sub_mode_aborts_start():
    eng = _engine(); _start(eng, ["A"], sequence=["x01", "nope"])
    assert eng.state.mode == "none"
    assert any(getattr(e, "category", None) == "command" for e in eng._pending)


def test_undo_across_leg_boundary():
    eng = _engine(); _start(eng, ["A"], sequence=["count_up", "x01"], rounds=1)
    eng.on_dart(Dart.from_bed("S5"))         # count_up dart 1 (total 5)
    eng.on_dart(Dart.from_bed("S5"))         # count_up dart 2 (total 10)
    eng.on_dart(Dart.from_bed("S5"))         # count_up dart 3 -> wins leg 1, advance to x01
    assert eng.state.mode_view["medley"]["current"] == "x01"
    eng.handle_command(Undo(command="undo"))  # undo the leg-winning dart -> back to count_up leg 1
    assert eng.state.mode_view["medley"]["current"] == "count_up"
    assert eng.state.mode_view["total"]["p1"] == 10              # count_up state restored
    # the restored count_up mode still functions: undo once more, then a non-final dart scores
    eng.handle_command(Undo(command="undo"))  # back to after dart 1 (total 5, 1 dart in the turn)
    eng.on_dart(Dart.from_bed("S20"))         # 2nd dart of the turn -> scores, does NOT end the leg
    assert eng.state.mode_view["total"]["p1"] == 25
    assert eng.state.mode_view["medley"]["current"] == "count_up"
