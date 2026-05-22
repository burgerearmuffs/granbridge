from granbridge.protocol.segment_map import SegmentMap
from granbridge.events.models import Ring

def test_seeded_bull_codes_resolve():
    sm = SegmentMap()
    assert sm.lookup("8.0") == (Ring.SBULL, 25)
    assert sm.lookup("4.0") == (Ring.DBULL, 50)
    assert sm.lookup("OUT") == (Ring.OUT, None)

def test_unknown_code_returns_none():
    assert SegmentMap().lookup("99.99") is None

def test_override_takes_precedence_and_round_trips(tmp_path):
    sm = SegmentMap()
    sm.set_override("12.3", Ring.TRIPLE, 20)
    assert sm.lookup("12.3") == (Ring.TRIPLE, 20)
    path = tmp_path / "ov.json"
    sm.save(path)
    reloaded = SegmentMap.load(path)
    assert reloaded.lookup("12.3") == (Ring.TRIPLE, 20)
    assert reloaded.lookup("8.0") == (Ring.SBULL, 25)
