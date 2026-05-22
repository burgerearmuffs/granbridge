from __future__ import annotations

import asyncio
from typing import Optional

import structlog
from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from granbridge.core.bus import EventBus

log = structlog.get_logger(__name__)


class WebSocketServer:
    """Broadcasts every bus event as JSON. New clients get a snapshot first."""

    def __init__(self, bus: EventBus, host: str, port: int) -> None:
        self._bus = bus
        self._host = host
        self._port = port
        self._server: Optional[Server] = None

    async def start(self) -> None:
        self._server = await serve(self._handle, self._host, self._port)
        log.info("ws_server.started", host=self._host, port=self._port)

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    async def _handle(self, ws: ServerConnection) -> None:
        for event in self._bus.snapshot():
            await ws.send(event.model_dump_json())
        with self._bus.subscribe() as sub:
            try:
                while True:
                    get_task = asyncio.ensure_future(sub.get())
                    close_task = asyncio.ensure_future(ws.wait_closed())
                    done, pending = await asyncio.wait(
                        [get_task, close_task],
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    for t in pending:
                        t.cancel()
                    if close_task in done:
                        return
                    event = get_task.result()
                    await ws.send(event.model_dump_json())
            except ConnectionClosed:
                return
