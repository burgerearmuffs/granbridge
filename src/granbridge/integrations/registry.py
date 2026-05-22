from __future__ import annotations

from granbridge.commentary.plugin import CommentaryPlugin
from granbridge.config import Settings
from granbridge.integrations.base import Plugin
from granbridge.integrations.plugins.discord_plugin import DiscordWebhookPlugin
from granbridge.integrations.plugins.logging_plugin import LoggingPlugin
from granbridge.integrations.plugins.mqtt_plugin import MqttPlugin
from granbridge.integrations.plugins.wled_plugin import WledPlugin
from granbridge.net.relay_plugin import RelayPlugin

_REGISTRY: dict[str, type[Plugin]] = {
    "logging": LoggingPlugin,
    "mqtt": MqttPlugin,
    "discord": DiscordWebhookPlugin,
    "wled": WledPlugin,
    "relay": RelayPlugin,
    "commentary": CommentaryPlugin,
}


def build_enabled(settings: Settings) -> list[Plugin]:
    out: list[Plugin] = []
    for name in settings.plugins_enabled:
        cls = _REGISTRY.get(name)
        if cls is not None:
            out.append(cls(settings.plugins.get(name, {})))
    return out
