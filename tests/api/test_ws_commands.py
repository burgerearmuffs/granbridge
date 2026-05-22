import asyncio, json, pytest, websockets
from granbridge.core.bus import EventBus
from granbridge.api.ws_server import WebSocketServer

async def test_inbound_command_routed():
    bus = EventBus()
    received = []
    server = WebSocketServer(bus, "127.0.0.1", 8801, command_handler=received.append)
    await server.start()
    try:
        async with websockets.connect("ws://127.0.0.1:8801") as ws:
            await ws.send(json.dumps({"command": "next_player"}))
            await asyncio.sleep(0.1)
        assert received and received[0]["command"] == "next_player"
    finally:
        await server.stop()
