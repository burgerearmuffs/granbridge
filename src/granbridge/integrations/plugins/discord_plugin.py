from __future__ import annotations

from typing import Awaitable, Callable, Optional

from granbridge.events.models import BaseEvent
from granbridge.integrations.base import Plugin

Poster = Callable[[str, dict], Awaitable[object]]


class DiscordWebhookPlugin(Plugin):
    name = "discord"

    def __init__(self, config: dict, poster: Optional[Poster] = None) -> None:
        super().__init__(config)
        self._url = config.get("webhook_url", "")
        self._poster = poster
        self._http = None

    async def start(self) -> None:
        if self._poster is None and self._url:
            import httpx  # lazy
            self._http = httpx.AsyncClient(timeout=5.0)
            self._poster = lambda url, payload: self._http.post(url, json=payload)

    async def stop(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    async def handle(self, event: BaseEvent) -> None:
        if not self._url or self._poster is None:
            return
        if event.type == "game_won":
            await self._poster(self._url, {"content": f"\U0001F3C6 {event.player} wins the game!"})
        elif event.type == "leg_won":
            await self._poster(self._url, {"content": f"\U0001F3AF {event.player} takes a leg ({event.legs})"})
