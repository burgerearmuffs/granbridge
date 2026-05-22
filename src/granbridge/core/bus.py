from __future__ import annotations

import asyncio

from granbridge.events.models import BaseEvent

_DEFAULT_MAXSIZE = 1000


class Subscription:
    """A bus subscription backed by a bounded queue. Use as a context manager.

    When the queue is full the OLDEST item is dropped so that a stalled consumer
    cannot grow memory unbounded and always receives the freshest events.
    """

    def __init__(self, bus: "EventBus", maxsize: int = _DEFAULT_MAXSIZE) -> None:
        self._bus = bus
        self._queue: asyncio.Queue[BaseEvent] = asyncio.Queue(maxsize=maxsize)

    def _put(self, event: BaseEvent) -> None:
        if self._queue.full():
            try:
                self._queue.get_nowait()  # drop oldest
            except asyncio.QueueEmpty:
                pass
        self._queue.put_nowait(event)

    async def get(self) -> BaseEvent:
        return await self._queue.get()

    def empty(self) -> bool:
        return self._queue.empty()

    def __enter__(self) -> "Subscription":
        self._bus._add(self)
        return self

    def __exit__(self, *exc: object) -> None:
        self._bus._remove(self)


class EventBus:
    """In-process async pub/sub with a last-event-per-type snapshot."""

    def __init__(self) -> None:
        self._subs: set[Subscription] = set()
        self._last: dict[str, BaseEvent] = {}

    def _add(self, sub: Subscription) -> None:
        self._subs.add(sub)

    def _remove(self, sub: Subscription) -> None:
        self._subs.discard(sub)

    def subscribe(self, maxsize: int = _DEFAULT_MAXSIZE) -> Subscription:
        return Subscription(self, maxsize=maxsize)

    async def publish(self, event: BaseEvent) -> None:
        self._last[event.type] = event
        for sub in list(self._subs):
            sub._put(event)

    def snapshot(self) -> list[BaseEvent]:
        return list(self._last.values())
