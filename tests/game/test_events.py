import json
from granbridge.game.events import GameStarted, GameStateEvent, Bust, LegWon, GameWon
from granbridge.game.models import GameState
from granbridge.events.models import ErrorEvent

def test_game_state_event_wraps_state():
    gs = GameState(mode="x01")
    ev = GameStateEvent(state=gs)
    data = json.loads(ev.model_dump_json())
    assert data["type"] == "game_state" and data["state"]["mode"] == "x01"

def test_transition_events_types():
    assert GameStarted(mode="x01", players=[], options={}).type == "game_started"
    assert Bust(player="p1", score_attempted=10, reason="overshoot").type == "bust"
    assert LegWon(player="p1", legs=1, sets=0).type == "leg_won"
    assert GameWon(player="p1").type == "game_won"

def test_error_event_accepts_command_category():
    assert ErrorEvent(category="command", message="bad").category == "command"
