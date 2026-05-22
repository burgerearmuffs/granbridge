from granbridge.game.checkout import suggest

def test_known_checkouts():
    assert suggest(170, 3, True) == ["T20", "T20", "BULL"]
    assert suggest(167, 3, True) == ["T20", "T19", "BULL"]
    assert suggest(40, 2, True) == ["D20"]
    assert suggest(32, 1, True) == ["D16"]
    assert suggest(36, 1, True) == ["D18"]

def test_bogey_and_too_high_return_none():
    for n in (169, 168, 166, 165, 163, 162, 159):
        assert suggest(n, 3, True) is None
    assert suggest(171, 3, True) is None

def test_respects_darts_left():
    # 170 needs 3 darts; with only 1 left there is no checkout
    assert suggest(170, 1, True) is None

def test_double_out_disabled_allows_single_finish():
    assert suggest(20, 1, False) == ["S20"]
