from __future__ import annotations

import asyncio
import json
from typing import Callable, Optional

import structlog
from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from granbridge.core.bus import EventBus

log = structlog.get_logger(__name__)


class WebSocketServer:
    """Broadcasts bus events as JSON (snapshot first), and optionally routes
    inbound JSON commands to `command_handler`."""

    def __init__(self, bus: EventBus, host: str, port: int,
                 command_handler: Optional[Callable[[dict], None]] = None) -> None:
        self._bus = bus
        self._host = host
        self._port = port
        self._command_handler = command_handler
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
            outbound = asyncio.ensure_future(self._pump_out(ws, sub))
            inbound = asyncio.ensure_future(self._pump_in(ws))
            try:
                await asyncio.wait({outbound, inbound}, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for t in (outbound, inbound):
                    t.cancel()

    async def _pump_out(self, ws: ServerConnection, sub) -> None:
        try:
            while True:
                event = await sub.get()
                await ws.send(event.model_dump_json())
        except ConnectionClosed:
            return

    async def _pump_in(self, ws: ServerConnection) -> None:
        try:
            async for raw in ws:
                if self._command_handler is None:
                    continue
                try:
                    self._command_handler(json.loads(raw))
                except Exception as exc:  # noqa: BLE001 - report, don't crash the socket
                    log.warning("ws.bad_command", error=str(exc))
        except ConnectionClosed:
            return
