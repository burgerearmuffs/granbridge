from granbridge.game.models import Dart, GameState, Player
from granbridge.game.modes.x01 import X01Mode

def _state(opts):
    gs = GameState(mode="x01", players=[Player(id="p1", name="A"), Player(id="p2", name="B")])
    X01Mode().on_start(gs, opts)
    return gs

def test_scores_subtract_from_start():
    gs = _state({"start_score": 501})
    r = X01Mode().apply_dart(gs, Dart.from_bed("T20"))
    assert r.points == 60 and gs.mode_view["scores"]["p1"] == 441

def test_double_out_win_on_double():
    gs = _state({"start_score": 40, "double_out": True})
    r = X01Mode().apply_dart(gs, Dart.from_bed("D20"))
    assert r.leg_won is True and r.winner == "p1" and gs.mode_view["scores"]["p1"] == 0

def test_single_finish_busts_with_double_out():
    gs = _state({"start_score": 40, "double_out": True})
    m = X01Mode()
    assert m.apply_dart(gs, Dart.from_bed("S20")).busted is False  # 40 -> 20
    assert m.apply_dart(gs, Dart.from_bed("S20")).busted is True   # 20 -> 0 on a single = bust

def test_overshoot_busts():
    gs = _state({"start_score": 20, "double_out": True})
    assert X01Mode().apply_dart(gs, Dart.from_bed("T20")).busted is True

def test_leave_one_busts_on_double_out():
    gs = _state({"start_score": 20, "double_out": True})
    assert X01Mode().apply_dart(gs, Dart.from_bed("S19")).busted is True

def test_double_in_gates_scoring():
    gs = _state({"start_score": 501, "double_in": True})
    m = X01Mode()
    assert m.apply_dart(gs, Dart.from_bed("S20")).points == 0 and gs.mode_view["scores"]["p1"] == 501
    m.apply_dart(gs, Dart.from_bed("D20"))
    assert gs.mode_view["scores"]["p1"] == 461

def test_checkout_hint_present_when_in_range():
    gs = _state({"start_score": 40, "double_out": True})
    assert X01Mode().checkout_hint(gs) == ["D20"]
