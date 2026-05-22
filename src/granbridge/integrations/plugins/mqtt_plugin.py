from __future__ import annotations

from typing import Optional

from granbridge.events.models import BaseEvent
from granbridge.integrations.base import Plugin

_TOPIC = {"dart_hit": "throw", "game_state": "game"}


class MqttPlugin(Plugin):
    name = "mqtt"

    def __init__(self, config: dict, client: Optional[object] = None) -> None:
        super().__init__(config)
        self._client = client
        self._owns = client is None
        self._prefix = config.get("prefix", "granboard")
        self._host = config.get("host", "localhost")
        self._port = int(config.get("port", 1883))

    async def start(self) -> None:
        if self._client is None:
            import aiomqtt  # lazy
            self._client = aiomqtt.Client(hostname=self._host, port=self._port)
            await self._client.__aenter__()

    async def stop(self) -> None:
        if self._owns and self._client is not None:
            await self._client.__aexit__(None, None, None)
            self._client = None

    def _topic(self, event_type: str) -> str:
        return f"{self._prefix}/{_TOPIC.get(event_type, 'event')}"

    async def handle(self, event: BaseEvent) -> None:
        if self._client is None:
            return
        await self._client.publish(self._topic(event.type), event.model_dump_json())
