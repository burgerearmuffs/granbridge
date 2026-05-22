from __future__ import annotations

from abc import ABC, abstractmethod

from granbridge.events.models import BaseEvent


class Plugin(ABC):
    """A bus consumer. Plugins filter by event.type inside handle(); they never publish."""

    name: str = "plugin"

    def __init__(self, config: dict) -> None:
        self.config = config or {}

    async def start(self) -> None:  # optional setup (open connections)
        return None

    async def stop(self) -> None:  # optional teardown
        return None

    @abstractmethod
    async def handle(self, event: BaseEvent) -> None:
        """Handle one bus event. Must not raise to the manager (manager isolates anyway)."""
