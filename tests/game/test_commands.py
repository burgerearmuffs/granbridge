import pytest
from granbridge.game.commands import parse_command, StartGame, NextPlayer, Undo, CorrectLast, RecordMiss, EndGame

def test_parse_start_game():
    cmd = parse_command({"command": "start_game", "mode": "x01", "players": ["A", "B"], "options": {"start_score": 501}})
    assert isinstance(cmd, StartGame) and cmd.mode == "x01" and cmd.players == ["A", "B"]

def test_parse_simple_commands():
    assert isinstance(parse_command({"command": "next_player"}), NextPlayer)
    assert isinstance(parse_command({"command": "undo"}), Undo)
    assert isinstance(parse_command({"command": "record_miss"}), RecordMiss)
    assert isinstance(parse_command({"command": "end_game"}), EndGame)

def test_parse_correct_last():
    cmd = parse_command({"command": "correct_last", "bed": "T20"})
    assert isinstance(cmd, CorrectLast) and cmd.bed == "T20"

def test_parse_unknown_raises():
    with pytest.raises(ValueError):
        parse_command({"command": "nope"})
