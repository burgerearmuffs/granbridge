from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field

SCHEMA_VERSION = "1.0"


def utc_now_iso() -> str:
    """ISO-8601 UTC timestamp with millisecond precision and trailing 'Z'."""
    dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


class Ring(str, Enum):
    SINGLE_OUTER = "SO"
    SINGLE_INNER = "SI"
    DOUBLE = "D"
    TRIPLE = "T"
    SBULL = "SBULL"
    DBULL = "DBULL"
    OUT = "OUT"


class BaseEvent(BaseModel):
    schema_version: str = SCHEMA_VERSION
    type: str
    timestamp: str = Field(default_factory=utc_now_iso)


class DartHit(BaseEvent):
    type: Literal["dart_hit"] = "dart_hit"
    raw: str
    ring: Ring
    segment: Optional[int]
    multiplier: int
    bed: str
    score: int


class ConnectionState(BaseEvent):
    type: Literal["connection_state"] = "connection_state"
    state: Literal["scanning", "connecting", "connected", "reconnecting", "disconnected"]
    device: Optional[str] = None
    rssi: Optional[int] = None


class ButtonEvent(BaseEvent):
    type: Literal["button"] = "button"
    raw: str
    name: str


class Heartbeat(BaseEvent):
    type: Literal["heartbeat"] = "heartbeat"
    source: Literal["board", "watchdog"]


class ErrorEvent(BaseEvent):
    type: Literal["error"] = "error"
    category: Literal["ble", "decode", "transport", "command"]
    message: str
    recoverable: bool = True
