from granbridge.config import Settings
from granbridge.integrations.registry import build_enabled
from granbridge.integrations.plugins.logging_plugin import LoggingPlugin
from granbridge.integrations.plugins.mqtt_plugin import MqttPlugin


def test_build_enabled_instantiates_named_plugins():
    s = Settings(plugins_enabled=["logging", "mqtt"], plugins={"mqtt": {"prefix": "darts"}})
    plugins = build_enabled(s)
    assert [type(p) for p in plugins] == [LoggingPlugin, MqttPlugin]
    assert plugins[1]._prefix == "darts"


def test_unknown_plugin_skipped():
    s = Settings(plugins_enabled=["nope"])
    assert build_enabled(s) == []
