from granbridge.core.bus import EventBus
from granbridge.game.engine import GameEngine
from granbridge.game.commands import parse_command

def test_command_handler_parses_and_dispatches():
    eng = GameEngine(EventBus())
    handler = lambda payload: eng.handle_command(parse_command(payload))
    handler({"command": "start_game", "mode": "free_play", "players": ["A"], "options": {}})
    assert eng.state.status.value == "in_progress" and eng.state.mode == "free_play"
