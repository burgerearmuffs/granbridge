import pytest
from granbridge.game.modes.base import GameMode, DartResult

def test_dart_result_defaults():
    r = DartResult(points=20)
    assert r.points == 20 and r.busted is False and r.leg_won is False and r.winner is None

def test_gamemode_is_abstract():
    with pytest.raises(TypeError):
        GameMode()  # abstract
