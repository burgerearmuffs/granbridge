from granbridge.integrations.plugins.mqtt_plugin import MqttPlugin
from granbridge.events.models import DartHit, Ring, ConnectionState

class FakeClient:
    def __init__(self): self.published = []
    async def publish(self, topic, payload): self.published.append((topic, payload))

async def test_dart_hit_publishes_to_throw_topic():
    fake = FakeClient()
    p = MqttPlugin({"prefix": "granboard"}, client=fake)
    await p.handle(DartHit(raw="T20@", ring=Ring.TRIPLE, segment=20, multiplier=3, bed="T20", score=60))
    assert fake.published and fake.published[0][0] == "granboard/throw"
    assert '"bed":"T20"' in fake.published[0][1].replace(" ", "")

async def test_connection_state_publishes_to_event_topic():
    fake = FakeClient()
    p = MqttPlugin({"prefix": "granboard"}, client=fake)
    await p.handle(ConnectionState(state="connected"))
    assert fake.published[0][0] == "granboard/event"

async def test_no_client_is_noop():
    p = MqttPlugin({})  # not started, no client
    await p.handle(ConnectionState(state="connected"))  # no error
