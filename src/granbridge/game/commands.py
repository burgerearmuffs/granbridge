from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel


class StartGame(BaseModel):
    command: Literal["start_game"]
    mode: str
    players: list[str]
    options: dict[str, Any] = {}


class NextPlayer(BaseModel):
    command: Literal["next_player"]


class RecordMiss(BaseModel):
    command: Literal["record_miss"]


class Undo(BaseModel):
    command: Literal["undo"]


class CorrectLast(BaseModel):
    command: Literal["correct_last"]
    bed: str


class EndGame(BaseModel):
    command: Literal["end_game"]


Command = Union[StartGame, NextPlayer, RecordMiss, Undo, CorrectLast, EndGame]

_BY_NAME = {
    "start_game": StartGame, "next_player": NextPlayer, "record_miss": RecordMiss,
    "undo": Undo, "correct_last": CorrectLast, "end_game": EndGame,
}


def parse_command(payload: dict) -> Command:
    name = payload.get("command")
    model = _BY_NAME.get(name)
    if model is None:
        raise ValueError(f"unknown command: {name!r}")
    return model.model_validate(payload)
