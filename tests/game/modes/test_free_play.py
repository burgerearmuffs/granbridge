from granbridge.game.models import Dart, GameState, Player
from granbridge.game.modes.free_play import FreePlayMode

def _state():
    gs = GameState(mode="free_play", players=[Player(id="p1", name="A")])
    FreePlayMode().on_start(gs, {})
    return gs

def test_accumulates_total_and_hits():
    gs = _state(); m = FreePlayMode()
    m.apply_dart(gs, Dart.from_bed("T20"))
    m.apply_dart(gs, Dart.from_bed("T20"))
    assert gs.mode_view["total"]["p1"] == 120
    assert gs.mode_view["hits"]["p1"]["T20"] == 2

def test_never_wins():
    gs = _state()
    r = FreePlayMode().apply_dart(gs, Dart.from_bed("BULL"))
    assert r.leg_won is False and r.winner is None
