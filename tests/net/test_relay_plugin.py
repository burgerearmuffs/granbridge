from granbridge.net.relay_plugin import RelayPlugin
from granbridge.events.models import ConnectionState

async def test_forwards_event_to_injected_sender():
    sent = []
    async def sender(text): sent.append(text)
    p = RelayPlugin({"url": "ws://x", "room": "r1"}, sender=sender)
    await p.handle(ConnectionState(state="connected"))
    assert sent and '"type":"connection_state"' in sent[0].replace(" ", "")

async def test_no_url_is_noop():
    sent = []
    async def sender(text): sent.append(text)
    p = RelayPlugin({}, sender=sender)
    await p.handle(ConnectionState(state="connected"))
    assert sent == []
