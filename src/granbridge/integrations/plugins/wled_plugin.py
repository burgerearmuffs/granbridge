from __future__ import annotations

from typing import Awaitable, Callable, Optional

from granbridge.events.models import BaseEvent
from granbridge.integrations.base import Plugin

Poster = Callable[[str, dict], Awaitable[object]]


class WledPlugin(Plugin):
    name = "wled"

    def __init__(self, config: dict, poster: Optional[Poster] = None) -> None:
        super().__init__(config)
        self._host = config.get("host", "")
        self._win_fx = int(config.get("win_fx", 80))
        self._bust_fx = int(config.get("bust_fx", 1))
        self._poster = poster
        self._http = None

    async def start(self) -> None:
        if self._poster is None and self._host:
            import httpx  # lazy
            self._http = httpx.AsyncClient(timeout=5.0)
            self._poster = lambda url, payload: self._http.post(url, json=payload)

    async def stop(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    async def handle(self, event: BaseEvent) -> None:
        if not self._host or self._poster is None:
            return
        url = f"http://{self._host}/json/state"
        if event.type == "game_won":
            await self._poster(url, {"on": True, "seg": [{"fx": self._win_fx}]})
        elif event.type == "bust":
            await self._poster(url, {"on": True, "seg": [{"fx": self._bust_fx, "col": [[255, 0, 0]]}]})
