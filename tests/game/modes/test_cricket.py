from granbridge.game.models import Dart, GameState, Player
from granbridge.game.modes.cricket import CricketMode

def _state():
    gs = GameState(mode="cricket", players=[Player(id="p1", name="A"), Player(id="p2", name="B")])
    CricketMode().on_start(gs, {})
    return gs

def test_three_singles_close_number():
    gs = _state(); m = CricketMode()
    for _ in range(3):
        m.apply_dart(gs, Dart.from_bed("S20"))
    assert gs.mode_view["marks"]["p1"]["20"] == 3

def test_treble_gives_three_marks():
    gs = _state()
    CricketMode().apply_dart(gs, Dart.from_bed("T20"))
    assert gs.mode_view["marks"]["p1"]["20"] == 3

def test_points_scored_when_open_and_opponent_not_closed():
    gs = _state(); m = CricketMode()
    m.apply_dart(gs, Dart.from_bed("T20"))   # closes 20
    m.apply_dart(gs, Dart.from_bed("T20"))   # 3 extra marks -> 60 points
    assert gs.mode_view["points"]["p1"] == 60

def test_non_cricket_number_ignored():
    gs = _state()
    r = CricketMode().apply_dart(gs, Dart.from_bed("S5"))
    assert r.points == 0 and gs.mode_view["marks"]["p1"].get("5", 0) == 0

def test_win_all_closed_and_points_ahead():
    gs = _state(); m = CricketMode()
    for num in ["20", "19", "18", "17", "16", "15"]:
        for _ in range(3):
            m.apply_dart(gs, Dart.from_bed(f"S{num}"))
    m.apply_dart(gs, Dart.from_bed("BULL"))
    m.apply_dart(gs, Dart.from_bed("BULL"))
    last = m.apply_dart(gs, Dart.from_bed("BULL"))  # 3rd bull mark closes bull; opponent at 0
    assert gs.mode_view["marks"]["p1"]["B"] == 3 and last.leg_won is True and last.winner == "p1"
