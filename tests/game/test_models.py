from granbridge.game.models import Dart, GameState, GameStatus, Player, PlayerStats

def test_dart_from_bed_parses_all_ring_types():
    assert (Dart.from_bed("T20").score, Dart.from_bed("T20").multiplier) == (60, 3)
    assert (Dart.from_bed("D16").score, Dart.from_bed("D16").segment) == (32, 16)
    assert (Dart.from_bed("S5").score, Dart.from_bed("S5").multiplier) == (5, 1)
    assert Dart.from_bed("BULL").score == 25 and Dart.from_bed("BULL").segment == 25
    assert Dart.from_bed("DBULL").score == 50 and Dart.from_bed("DBULL").multiplier == 2
    miss = Dart.from_bed("MISS")
    assert miss.score == 0 and miss.segment is None and miss.multiplier == 0

def test_player_stats_three_dart_average():
    s = PlayerStats(darts=6, total_scored=180)
    assert s.three_dart_avg == 90.0
    assert PlayerStats().three_dart_avg == 0.0

def test_gamestate_active_player_id():
    gs = GameState(mode="x01", players=[Player(id="p1", name="A"), Player(id="p2", name="B")], active_index=1)
    assert gs.active_player_id == "p2"
    assert gs.status == GameStatus.WAITING
