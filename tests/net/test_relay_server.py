import asyncio, pytest, websockets
from granbridge.net.relay_server import RelayServer

async def test_relay_broadcasts_within_room_only():
    server = RelayServer("127.0.0.1", 8790)
    await server.start()
    try:
        async with websockets.connect("ws://127.0.0.1:8790?room=r1") as a, \
                   websockets.connect("ws://127.0.0.1:8790?room=r1") as b, \
                   websockets.connect("ws://127.0.0.1:8790?room=r2") as c:
            await asyncio.sleep(0.1)
            await a.send("hello")
            assert await asyncio.wait_for(b.recv(), timeout=1) == "hello"
            with pytest.raises(asyncio.TimeoutError):       # different room: nothing
                await asyncio.wait_for(c.recv(), timeout=0.3)
            with pytest.raises(asyncio.TimeoutError):       # sender not echoed
                await asyncio.wait_for(a.recv(), timeout=0.3)
    finally:
        await server.stop()
