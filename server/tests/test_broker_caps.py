import asyncio, json, pytest, websockets
from granbridge_broker.broker import BrokerServer

async def _recv(ws): return json.loads(await asyncio.wait_for(ws.recv(), timeout=1))

async def _join(ws, room, pw, pid):
    await ws.send(json.dumps({"type": "join", "room": room, "password": pw,
                              "player": {"id": pid, "name": pid}}))

@pytest.fixture
async def server():
    s = BrokerServer("127.0.0.1", 8796, max_rooms=2)
    await s.start()
    yield s
    await s.stop()

async def test_new_room_beyond_cap_is_rejected(server):
    a = await websockets.connect("ws://127.0.0.1:8796")
    b = await websockets.connect("ws://127.0.0.1:8796")
    c = await websockets.connect("ws://127.0.0.1:8796")
    try:
        await _join(a, "r1", "p", "A"); await _recv(a)   # rooms = 1
        await _join(b, "r2", "p", "B"); await _recv(b)   # rooms = 2 (at cap)
        await _join(c, "r3", "p", "C")                   # new room beyond cap
        err = await _recv(c)
        assert err["type"] == "error" and err["code"] == "server_full"
    finally:
        for ws in (a, b, c): await ws.close()

async def test_join_existing_room_still_ok_at_cap(server):
    a = await websockets.connect("ws://127.0.0.1:8796")
    b = await websockets.connect("ws://127.0.0.1:8796")
    c = await websockets.connect("ws://127.0.0.1:8796")
    try:
        await _join(a, "r1", "p", "A"); await _recv(a)   # rooms = 1
        await _join(b, "r2", "p", "B"); await _recv(b)   # rooms = 2 (at cap)
        await _join(c, "r1", "p", "C")                   # EXISTING room — allowed
        joined = await _recv(c)
        assert joined["type"] == "joined"
    finally:
        for ws in (a, b, c): await ws.close()
