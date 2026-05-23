import asyncio
import json
import pytest
import websockets
from granbridge.core.bus import EventBus
from granbridge.api.ws_server import WebSocketServer, _origin_policy
from granbridge.events.models import DartHit, Ring, ConnectionState

def _hit():
    return DartHit(raw="8.0@", ring=Ring.SBULL, segment=25, multiplier=1, bed="BULL", score=25)

async def test_client_receives_snapshot_then_live_event():
    bus = EventBus()
    await bus.publish(ConnectionState(state="connected"))
    server = WebSocketServer(bus, host="127.0.0.1", port=8799)
    await server.start()
    try:
        async with websockets.connect("ws://127.0.0.1:8799") as ws:
            snap = json.loads(await asyncio.wait_for(ws.recv(), timeout=1))
            assert snap["type"] == "connection_state"
            await bus.publish(_hit())
            live = json.loads(await asyncio.wait_for(ws.recv(), timeout=1))
            assert live["type"] == "dart_hit" and live["score"] == 25
    finally:
        await server.stop()

def test_origin_policy_loopback_allows_all():
    assert _origin_policy("127.0.0.1", 8080, []) is None
    assert _origin_policy("localhost", 8080, []) is None
    assert _origin_policy("::1", 8080, []) is None

def test_origin_policy_non_loopback_enforces_allowlist():
    origins = _origin_policy("0.0.0.0", 8080, [])
    assert origins is not None
    assert "http://0.0.0.0:8080" in origins
    assert "http://localhost:8080" in origins
    assert "http://127.0.0.1:8080" in origins
    assert None in origins

def test_origin_policy_includes_extras():
    origins = _origin_policy("tower.example", 8080, ["https://my.app"])
    assert "https://my.app" in origins
    assert None in origins
