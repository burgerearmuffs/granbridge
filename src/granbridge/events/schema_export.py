from __future__ import annotations

import json
from pathlib import Path

from granbridge.events.models import (
    ButtonEvent,
    ConnectionState,
    DartHit,
    ErrorEvent,
    Heartbeat,
)
from granbridge.game.events import Bust, GameStarted, GameStateEvent, GameWon, LegWon

_EVENT_TYPES = {
    "dart_hit": DartHit,
    "connection_state": ConnectionState,
    "button": ButtonEvent,
    "heartbeat": Heartbeat,
    "error": ErrorEvent,
    "game_started": GameStarted,
    "game_state": GameStateEvent,
    "bust": Bust,
    "leg_won": LegWon,
    "game_won": GameWon,
}


def export_schemas(out_dir: Path) -> dict[str, Path]:
    """Write one JSON Schema file per event type. Returns {type_name: path}."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written: dict[str, Path] = {}
    for name, model in _EVENT_TYPES.items():
        path = out_dir / f"{name}.json"
        path.write_text(json.dumps(model.model_json_schema(), indent=2))
        written[name] = path
    return written
