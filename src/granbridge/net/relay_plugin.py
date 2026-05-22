from __future__ import annotations

from typing import Awaitable, Callable, Optional

from granbridge.events.models import BaseEvent
from granbridge.integrations.base import Plugin

Sender = Callable[[str], Awaitable[object]]


class RelayPlugin(Plugin):
    """Forwards local bus events to a relay room (for remote spectating/sync)."""

    name = "relay"

    def __init__(self, config: dict, sender: Optional[Sender] = None) -> None:
        super().__init__(config)
        self._url = config.get("url", "")
        self._room = config.get("room", "default")
        self._sender = sender
        self._ws = None

    async def start(self) -> None:
        if self._sender is None and self._url:
            import websockets  # lazy
            self._ws = await websockets.connect(f"{self._url}?room={self._room}")
            self._sender = self._ws.send

    async def stop(self) -> None:
        if self._ws is not None:
            await self._ws.close()
            self._ws = None

    async def handle(self, event: BaseEvent) -> None:
        if not self._url or self._sender is None:
            return
        await self._sender(event.model_dump_json())
