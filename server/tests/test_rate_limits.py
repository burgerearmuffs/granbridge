import asyncio, json, pytest, websockets
from granbridge_broker.broker import BrokerServer
from granbridge_broker.config import from_env

FROZEN = 1000.0

async def _recv(ws): return json.loads(await asyncio.wait_for(ws.recv(), timeout=1))
async def _join(ws, room, pw, pid):
    await ws.send(json.dumps({"type":"join","room":room,"password":pw,"player":{"id":pid,"name":pid}}))


def test_config_rate_defaults():
    cfg = from_env({"TURN_SECRET": "x", "DOMAIN": "d"})
    assert cfg.turn_rate_per_min == 30
    assert cfg.conn_rate_per_min == 60
    assert cfg.msg_rate_per_sec == 20


def test_turn_endpoint_rate_limited():
    s = BrokerServer("127.0.0.1", 0, turn_secret="sek", turn_domain="d",
                     turn_rate_per_min=2, clock=lambda: FROZEN)
    assert s._http_route("/turn", "1.2.3.4").status_code == 200
    assert s._http_route("/turn", "1.2.3.4").status_code == 200
    assert s._http_route("/turn", "1.2.3.4").status_code == 429   # 3rd over limit
    assert s._http_route("/turn", "9.9.9.9").status_code == 200   # different IP ok


@pytest.fixture
async def server():
    s = BrokerServer("127.0.0.1", 8797, conn_rate_per_min=2, msg_rate_per_sec=3,
                     clock=lambda: FROZEN)
    await s.start()
    yield s
    await s.stop()

async def test_ws_connect_rate_limited(server):
    a = await websockets.connect("ws://127.0.0.1:8797")
    b = await websockets.connect("ws://127.0.0.1:8797")
    try:
        with pytest.raises(websockets.exceptions.InvalidStatus):
            await websockets.connect("ws://127.0.0.1:8797")   # 3rd over limit → 429
    finally:
        await a.close(); await b.close()

async def test_message_flood_dropped(server):
    a = await websockets.connect("ws://127.0.0.1:8797")
    b = await websockets.connect("ws://127.0.0.1:8797")
    try:
        await _join(a, "r", "p", "A"); await _recv(a)
        await _join(b, "r", "p", "B"); await _recv(b); await _recv(a)
        for _ in range(5):
            await a.send(json.dumps({"type":"msg","payload":{"x":1}}))
        got = 0
        try:
            while True:
                await asyncio.wait_for(b.recv(), timeout=0.3); got += 1
        except asyncio.TimeoutError:
            pass
        assert got == 3   # msg_rate_per_sec=3 at the frozen clock → 3 relayed, 2 dropped
    finally:
        await a.close(); await b.close()
