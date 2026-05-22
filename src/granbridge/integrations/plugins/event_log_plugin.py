from __future__ import annotations

from pathlib import Path

from granbridge.events.models import BaseEvent
from granbridge.integrations.base import Plugin


class EventLogPlugin(Plugin):
    """Appends every bus event as a JSON line to <dir>/events.jsonl.

    Defensive: exceptions inside handle() are swallowed so a disk error never
    crashes the plugin manager.
    """

    name = "event_log"

    def __init__(self, config: dict) -> None:
        super().__init__(config)
        self._dir = Path(config.get("dir", "logs/decoded_packets"))

    async def start(self) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)

    async def handle(self, event: BaseEvent) -> None:
        try:
            line = event.model_dump_json() + "\n"
            with open(self._dir / "events.jsonl", "a", encoding="utf-8") as fh:
                fh.write(line)
        except Exception:
            pass  # never propagate – disk full, permissions, etc.

    async def stop(self) -> None:
        pass
