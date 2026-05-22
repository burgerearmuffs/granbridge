from granbridge.game.models import Dart, GameState, Player
from granbridge.game.modes.around_the_clock import AroundTheClockMode

def _state(opts=None):
    gs = GameState(mode="around_the_clock", players=[Player(id="p1", name="A")])
    AroundTheClockMode().on_start(gs, opts or {})
    return gs

def test_advances_on_correct_target():
    gs = _state(); m = AroundTheClockMode()
    assert gs.mode_view["target"]["p1"] == 1
    m.apply_dart(gs, Dart.from_bed("S1"))
    assert gs.mode_view["target"]["p1"] == 2

def test_wrong_target_no_advance():
    gs = _state()
    AroundTheClockMode().apply_dart(gs, Dart.from_bed("S5"))
    assert gs.mode_view["target"]["p1"] == 1

def test_singles_mode_rejects_double():
    gs = _state({"targets": "singles"})
    AroundTheClockMode().apply_dart(gs, Dart.from_bed("D1"))
    assert gs.mode_view["target"]["p1"] == 1

def test_any_mode_accepts_treble():
    gs = _state({"targets": "any"})
    AroundTheClockMode().apply_dart(gs, Dart.from_bed("T1"))
    assert gs.mode_view["target"]["p1"] == 2

def test_finishing_bull_wins():
    gs = _state({"include_bull": True}); m = AroundTheClockMode()
    gs.mode_view["target"]["p1"] = 21  # bull stage
    r = m.apply_dart(gs, Dart.from_bed("BULL"))
    assert r.leg_won is True and r.winner == "p1"
