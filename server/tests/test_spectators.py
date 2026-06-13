"""Spectator-mode broker tests: invisible to peers, separate cap, msg fan-out,
signal/msg send restrictions."""
import asyncio
import json

import pytest
import websockets

from granbridge_broker.broker import BrokerServer


async def _recv(ws):
    return json.loads(await asyncio.wait_for(ws.recv(), timeout=1))


async def _join(ws, room, pw, pid, spectator=False):
    await ws.send(json.dumps({
        "type": "join", "room": room, "password": pw,
        "player": {"id": pid, "name": pid}, "spectator": spectator,
    }))


@pytest.fixture
async def server():
    s = BrokerServer("127.0.0.1", 8796, spectator_cap=2)
    await s.start()
    yield s
    await s.stop()


URL = "ws://127.0.0.1:8796"


async def test_spectator_not_listed_in_peers(server):
    async with websockets.connect(URL) as a, websockets.connect(URL) as spec:
        await _join(a, "r1", "pw", "A")
        ja = await _recv(a)
        assert ja["spectators"] == 0

        await _join(spec, "r1", "pw", "S", spectator=True)
        js = await _recv(spec)
        # Spectator sees the player list and itself counted
        assert js["type"] == "joined"
        assert [p["player"]["id"] for p in js["peers"]] == ["A"]
        assert js["spectators"] == 1

        # Player A gets a peers update: still no spectator in the list, count = 1
        pa = await _recv(a)
        assert pa["type"] == "peers"
        assert [p["player"]["id"] for p in pa["peers"]] == ["A"]
        assert pa["spectators"] == 1


async def test_spectator_receives_msg_broadcasts(server):
    async with websockets.connect(URL) as a, websockets.connect(URL) as spec:
        await _join(a, "r2", "pw", "A"); await _recv(a)
        await _join(spec, "r2", "pw", "S", spectator=True); await _recv(spec)
        await _recv(a)  # peers update from spectator join

        await a.send(json.dumps({"type": "msg", "payload": {"t": "spectate_state", "n": 1}}))
        m = await _recv(spec)
        assert m["type"] == "msg" and m["payload"]["t"] == "spectate_state"


async def test_spectator_cannot_signal_or_msg(server):
    async with websockets.connect(URL) as a, websockets.connect(URL) as spec:
        await _join(a, "r3", "pw", "A"); ja = await _recv(a)
        await _join(spec, "r3", "pw", "S", spectator=True); await _recv(spec)
        await _recv(a)

        await spec.send(json.dumps({"type": "signal", "to": ja["self"], "data": {"x": 1}}))
        e1 = await _recv(spec)
        assert e1["type"] == "error" and e1["code"] == "bad_request"

        await spec.send(json.dumps({"type": "msg", "payload": {"x": 1}}))
        e2 = await _recv(spec)
        assert e2["type"] == "error" and e2["code"] == "bad_request"


async def test_spectator_cap_independent_of_player_cap(server):
    async with websockets.connect(URL) as a:
        await _join(a, "r4", "pw", "A"); await _recv(a)
        async with websockets.connect(URL) as s1, websockets.connect(URL) as s2:
            await _join(s1, "r4", "pw", "S1", spectator=True); await _recv(s1)
            await _recv(a)
            await _join(s2, "r4", "pw", "S2", spectator=True); await _recv(s2)
            await _recv(a)
            # cap is 2 → third spectator is rejected, but a PLAYER can still join
            async with websockets.connect(URL) as s3, websockets.connect(URL) as b:
                await _join(s3, "r4", "pw", "S3", spectator=True)
                e = await _recv(s3)
                assert e["type"] == "error" and e["code"] == "room_full"

                await _join(b, "r4", "pw", "B")
                jb = await _recv(b)
                assert jb["type"] == "joined"
                assert jb["spectators"] == 2


async def test_spectator_leave_updates_count(server):
    async with websockets.connect(URL) as a:
        await _join(a, "r5", "pw", "A"); await _recv(a)
        async with websockets.connect(URL) as spec:
            await _join(spec, "r5", "pw", "S", spectator=True); await _recv(spec)
            pa = await _recv(a)
            assert pa["spectators"] == 1
        # spectator socket closed → count drops back to 0
        pa2 = await _recv(a)
        assert pa2["type"] == "peers" and pa2["spectators"] == 0
