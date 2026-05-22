from __future__ import annotations

import structlog

from granbridge.events.models import BaseEvent
from granbridge.integrations.base import Plugin

log = structlog.get_logger("granbridge.plugin.logging")


class LoggingPlugin(Plugin):
    name = "logging"

    async def handle(self, event: BaseEvent) -> None:
        log.info("event", type=event.type)
