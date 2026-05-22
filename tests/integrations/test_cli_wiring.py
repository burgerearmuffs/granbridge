from granbridge.config import Settings
from granbridge.integrations.registry import build_enabled
from granbridge.core.bus import EventBus
from granbridge.integrations.manager import PluginManager


def test_manager_builds_from_settings():
    s = Settings(plugins_enabled=["logging"])
    mgr = PluginManager(EventBus(), build_enabled(s))
    assert mgr is not None
