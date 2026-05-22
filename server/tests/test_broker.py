import asyncio, json, pytest, websockets
from granbridge_broker.broker import BrokerServer

async def _recv(ws): return json.loads(await asyncio.wait_for(ws.recv(), timeout=1))

async def _join(ws, room, pw, pid):
    await ws.send(json.dumps({"type":"join","room":room,"password":pw,"player":{"id":pid,"name":pid}}))

@pytest.fixture
async def server():
    s = BrokerServer("127.0.0.1", 8795); await s.start()
    yield s
    await s.stop()

async def test_join_creates_room_and_second_peer_sees_presence(server):
    async with websockets.connect("ws://127.0.0.1:8795") as a:
        await _join(a, "r1", "pw", "A"); ja = await _recv(a)
        assert ja["type"] == "joined" and ja["peers"] == []
        async with websockets.connect("ws://127.0.0.1:8795") as b:
            await _join(b, "r1", "pw", "B"); jb = await _recv(b)
            assert jb["type"] == "joined" and len(jb["peers"]) == 1
            # A gets a peers update naming B
            pa = await _recv(a)
            assert pa["type"] == "peers" and any(p["player"]["id"]=="B" for p in pa["peers"])

async def test_wrong_password_rejected(server):
    async with websockets.connect("ws://127.0.0.1:8795") as a:
        await _join(a, "r2", "right", "A"); await _recv(a)
        async with websockets.connect("ws://127.0.0.1:8795") as b:
            await _join(b, "r2", "WRONG", "B"); eb = await _recv(b)
            assert eb["type"] == "error" and eb["code"] == "bad_password"

async def test_signal_is_forwarded_to_target(server):
    async with websockets.connect("ws://127.0.0.1:8795") as a, websockets.connect("ws://127.0.0.1:8795") as b:
        await _join(a, "r3", "p", "A"); ja = await _recv(a)
        await _join(b, "r3", "p", "B"); jb = await _recv(b); await _recv(a)  # a's peers update
        a_id = ja["self"]
        await b.send(json.dumps({"type":"signal","to":a_id,"data":{"sdp":"x"}}))
        msg = await _recv(a)
        assert msg["type"]=="signal" and msg["data"]["sdp"]=="x" and msg["from"]==jb["self"]

async def test_msg_broadcast_to_others_not_sender(server):
    async with websockets.connect("ws://127.0.0.1:8795") as a, websockets.connect("ws://127.0.0.1:8795") as b:
        await _join(a, "r4", "p", "A"); await _recv(a)
        await _join(b, "r4", "p", "B"); await _recv(b); await _recv(a)
        await a.send(json.dumps({"type":"msg","payload":{"hello":1}}))
        m = await _recv(b)
        assert m["type"]=="msg" and m["payload"]["hello"]==1
        # sender should NOT receive its own msg
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(a.recv(), timeout=0.3)
