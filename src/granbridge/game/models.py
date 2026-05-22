from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, computed_field


class GameStatus(str, Enum):
    WAITING = "waiting"
    IN_PROGRESS = "in_progress"
    FINISHED = "finished"


class Player(BaseModel):
    id: str
    name: str


class Dart(BaseModel):
    bed: str
    ring: str
    segment: Optional[int]
    multiplier: int
    score: int

    @classmethod
    def from_bed(cls, bed: str) -> "Dart":
        bed = bed.upper().strip()
        if bed in ("MISS", "OUT", ""):
            return cls(bed="MISS", ring="OUT", segment=None, multiplier=0, score=0)
        if bed == "BULL":
            return cls(bed="BULL", ring="SBULL", segment=25, multiplier=1, score=25)
        if bed == "DBULL":
            return cls(bed="DBULL", ring="DBULL", segment=25, multiplier=2, score=50)
        prefix, number = bed[0], int(bed[1:])
        mult = {"S": 1, "D": 2, "T": 3}[prefix]
        ring = {"S": "SO", "D": "D", "T": "T"}[prefix]
        return cls(bed=bed, ring=ring, segment=number, multiplier=mult, score=number * mult)


class PlayerStats(BaseModel):
    darts: int = 0
    total_scored: int = 0

    @computed_field  # type: ignore[prop-decorator]
    @property
    def three_dart_avg(self) -> float:
        return round(self.total_scored / self.darts * 3, 2) if self.darts else 0.0


class GameState(BaseModel):
    mode: str
    status: GameStatus = GameStatus.WAITING
    players: list[Player] = []
    active_index: int = 0
    leg_starter_index: int = 0
    visit: list[Dart] = []
    legs: dict[str, int] = {}
    sets: dict[str, int] = {}
    winner: Optional[str] = None
    options: dict[str, Any] = {}
    mode_view: dict[str, Any] = {}
    stats: dict[str, PlayerStats] = {}

    @property
    def active_player_id(self) -> Optional[str]:
        if not self.players:
            return None
        return self.players[self.active_index % len(self.players)].id
