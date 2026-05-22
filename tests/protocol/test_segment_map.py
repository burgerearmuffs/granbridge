from granbridge.protocol.segment_map import SegmentMap
from granbridge.events.models import Ring

def test_seeded_bull_codes_resolve():
    sm = SegmentMap()
    assert sm.lookup("8.0") == (Ring.SBULL, 25)
    assert sm.lookup("4.0") == (Ring.DBULL, 50)
    assert sm.lookup("OUT") == (Ring.OUT, None)

def test_unknown_code_returns_none():
    assert SegmentMap().lookup("99.99") is None

def test_full_table_matches_live_hardware_capture():
    # The exact codes captured from a real GRANBOARD 3s on 2026-05-22 (gatt_dump).
    sm = SegmentMap()
    assert sm.lookup("3.5") == (Ring.SINGLE_OUTER, 20)
    assert sm.lookup("3.3") == (Ring.SINGLE_INNER, 20)
    assert sm.lookup("3.6") == (Ring.DOUBLE, 20)
    assert sm.lookup("3.4") == (Ring.TRIPLE, 20)
    assert sm.lookup("7.2") == (Ring.SINGLE_OUTER, 3)
    assert sm.lookup("7.1") == (Ring.SINGLE_INNER, 3)
    assert sm.lookup("8.4") == (Ring.DOUBLE, 3)   # note: doubles live on a different matrix row
    assert sm.lookup("7.0") == (Ring.TRIPLE, 3)

def test_full_table_is_complete_and_unique():
    seed = SegmentMap()._seed
    # 20 numbers x 4 rings (80) + SBULL + DBULL + OUT = 83 unique raw codes
    assert len(seed) == 83
    rings_by_number: dict[int, set] = {}
    for ring, num in seed.values():
        if num is not None and 1 <= num <= 20:
            rings_by_number.setdefault(num, set()).add(ring)
    for n in range(1, 21):
        assert rings_by_number[n] == {
            Ring.SINGLE_OUTER, Ring.SINGLE_INNER, Ring.DOUBLE, Ring.TRIPLE
        }, f"number {n} missing a ring"

def test_override_takes_precedence_and_round_trips(tmp_path):
    sm = SegmentMap()
    sm.set_override("12.3", Ring.TRIPLE, 20)
    assert sm.lookup("12.3") == (Ring.TRIPLE, 20)
    path = tmp_path / "ov.json"
    sm.save(path)
    reloaded = SegmentMap.load(path)
    assert reloaded.lookup("12.3") == (Ring.TRIPLE, 20)
    assert reloaded.lookup("8.0") == (Ring.SBULL, 25)
