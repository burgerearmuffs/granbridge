import pytest
from granbridge.core.bus import EventBus
from granbridge.integrations.base import Plugin
from granbridge.integrations.manager import PluginManager
from granbridge.events.models import ConnectionState

class Recorder(Plugin):
    name = "rec"
    def __init__(self, config=None):
        super().__init__(config or {})
        self.seen = []
        self.started = False
    async def start(self): self.started = True
    async def handle(self, event): self.seen.append(event.type)

class Boom(Plugin):
    name = "boom"
    def __init__(self, config=None):
        super().__init__(config or {})
    async def handle(self, event): raise RuntimeError("boom")

async def test_dispatch_reaches_all_plugins_with_isolation():
    rec, boom, rec2 = Recorder(), Boom(), Recorder()
    mgr = PluginManager(EventBus(), [rec, boom, rec2])
    await mgr.dispatch(ConnectionState(state="connected"))
    # boom raised but did not stop rec/rec2
    assert rec.seen == ["connection_state"] and rec2.seen == ["connection_state"]

async def test_start_all_calls_start():
    rec = Recorder()
    mgr = PluginManager(EventBus(), [rec])
    await mgr.start_all()
    assert rec.started is True
