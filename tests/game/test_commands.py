import pytest
from granbridge.game.commands import (
    parse_command, StartGame, NextPlayer, Undo, CorrectLast, RecordMiss, EndGame,
    RemoteDart, SetRemoteRole,
)

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

def test_parse_remote_dart():
    cmd = parse_command({"command": "remote_dart", "bed": "T20", "player": "p2"})
    assert isinstance(cmd, RemoteDart) and cmd.bed == "T20" and cmd.player == "p2"

def test_parse_set_remote_role():
    cmd = parse_command({"command": "set_remote_role", "player": "p1"})
    assert isinstance(cmd, SetRemoteRole) and cmd.player == "p1"

def test_parse_set_remote_role_defaults_none():
    cmd = parse_command({"command": "set_remote_role"})
    assert isinstance(cmd, SetRemoteRole) and cmd.player is None
