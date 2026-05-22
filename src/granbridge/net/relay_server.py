from __future__ import annotations

from typing import Optional
from urllib.parse import parse_qs, urlparse

import structlog
from websockets.asyncio.server import Server, ServerConnection, serve

log = structlog.get_logger(__name__)


class RelayServer:
    """Room-based rebroadcast relay. Clients connect with ?room=<id>; a message
    from one client is forwarded to all OTHER clients in the same room. No auth/persistence."""

    def __init__(self, host: str = "127.0.0.1", port: int = 8788) -> None:
        self._host = host
        self._port = port
        self._rooms: dict[str, set[ServerConnection]] = {}
        self._server: Optional[Server] = None

    async def start(self) -> None:
        self._server = await serve(self._handle, self._host, self._port)
        log.info("relay.started", host=self._host, port=self._port)

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    def _room_of(self, ws: ServerConnection) -> str:
        q = parse_qs(urlparse(ws.request.path).query)
        return (q.get("room", ["default"]) or ["default"])[0]

    async def _handle(self, ws: ServerConnection) -> None:
        room = self._room_of(ws)
        self._rooms.setdefault(room, set()).add(ws)
        try:
            async for message in ws:
                for peer in list(self._rooms.get(room, set())):
                    if peer is not ws:
                        await peer.send(message)
        finally:
            self._rooms.get(room, set()).discard(ws)
