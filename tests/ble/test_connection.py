import asyncio
import pytest
from granbridge.ble.transport import FakeTransport, DeviceInfo
from granbridge.ble.connection import ConnectionManager
from granbridge.core.bus import EventBus

def _mgr(transport):
    bus = EventBus()
    mgr = ConnectionManager(
        transport=transport, bus=bus, name_prefix="GRAN", service_uuid="svc",
        backoff_base=0.0, backoff_cap=0.0, heartbeat_timeout=10.0,
    )
    return bus, mgr

async def test_connect_subscribe_decodes_and_publishes_dart_hit():
    t = FakeTransport(devices=[DeviceInfo(name="GRAN_BOARD", address="A", rssi=-50)])
    bus, mgr = _mgr(t)
    with bus.subscribe() as sub:
        task = asyncio.create_task(mgr.run())
        await mgr.wait_connected(timeout=1)
        t.emit(b"8.0@")
        seen = None
        for _ in range(10):
            ev = await asyncio.wait_for(sub.get(), timeout=1)
            if ev.type == "dart_hit":
                seen = ev
                break
        assert seen is not None and seen.bed == "BULL"
        mgr.stop()
        await asyncio.wait_for(task, timeout=1)

async def test_reconnects_after_drop():
    t = FakeTransport(devices=[DeviceInfo(name="GRAN_BOARD", address="A", rssi=-50)])
    bus, mgr = _mgr(t)
    task = asyncio.create_task(mgr.run())
    await mgr.wait_connected(timeout=1)
    t.drop()
    await mgr.wait_connected(timeout=1)
    assert t.is_connected is True
    mgr.stop()
    await asyncio.wait_for(task, timeout=1)
