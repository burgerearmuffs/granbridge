from __future__ import annotations

import asyncio

import structlog

from granbridge.core.bus import EventBus
from granbridge.events.models import BaseEvent
from granbridge.integrations.base import Plugin

log = structlog.get_logger(__name__)


class PluginManager:
    """Subscribes to the bus and dispatches each event to every plugin, isolating errors."""

    def __init__(self, bus: EventBus, plugins: list[Plugin]) -> None:
        self._bus = bus
        self._plugins = plugins
        self._stop = asyncio.Event()

    async def start_all(self) -> None:
        for p in self._plugins:
            try:
                await p.start()
            except Exception as exc:  # noqa: BLE001 - a bad plugin must not stop the others
                log.warning("plugin.start_failed", plugin=p.name, error=str(exc))

    async def stop_all(self) -> None:
        for p in self._plugins:
            try:
                await p.stop()
            except Exception as exc:  # noqa: BLE001
                log.warning("plugin.stop_failed", plugin=p.name, error=str(exc))

    async def dispatch(self, event: BaseEvent) -> None:
        for p in self._plugins:
            try:
                await p.handle(event)
            except Exception as exc:  # noqa: BLE001 - isolation
                log.warning("plugin.error", plugin=p.name, type=event.type, error=str(exc))

    def stop(self) -> None:
        self._stop.set()

    async def run(self) -> None:
        if not self._plugins:
            return
        await self.start_all()
        try:
            with self._bus.subscribe() as sub:
                while not self._stop.is_set():
                    get = asyncio.ensure_future(sub.get())
                    stop = asyncio.ensure_future(self._stop.wait())
                    done, _ = await asyncio.wait({get, stop}, return_when=asyncio.FIRST_COMPLETED)
                    for t in (get, stop):
                        if not t.done():
                            t.cancel()
                    if self._stop.is_set():
                        break
                    if get in done:
                        await self.dispatch(get.result())
        finally:
            await self.stop_all()
