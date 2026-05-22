import asyncio
import pytest
from granbridge.ble.transport import FakeTransport, ReplayTransport, DeviceInfo

async def test_fake_scan_returns_scripted_devices():
    t = FakeTransport(devices=[DeviceInfo(name="GRAN_BOARD", address="AA:BB", rssi=-50)])
    found = await t.scan(name_prefix="GRAN", timeout=0.01)
    assert found[0].name == "GRAN_BOARD"

async def test_fake_subscribe_delivers_emitted_frames():
    t = FakeTransport(devices=[DeviceInfo(name="GRAN", address="A", rssi=-1)])
    await t.connect("A")
    received: list[bytes] = []
    await t.subscribe("char", received.append)
    t.emit(b"2.5@")
    assert received == [b"2.5@"]

async def test_fake_drop_marks_disconnected_and_fires_callback():
    t = FakeTransport(devices=[DeviceInfo(name="GRAN", address="A", rssi=-1)])
    flag = {"disc": False}
    await t.connect("A")
    t.on_disconnect(lambda: flag.__setitem__("disc", True))
    t.drop()
    assert t.is_connected is False and flag["disc"] is True

async def test_replay_emits_recorded_frames_in_order():
    t = ReplayTransport(frames=[b"8.0@", b"4.0@"], interval_s=0)
    await t.connect("A")
    received: list[bytes] = []
    await t.subscribe("char", received.append)
    await t.play()
    assert received == [b"8.0@", b"4.0@"]
