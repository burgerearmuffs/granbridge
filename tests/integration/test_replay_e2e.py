import asyncio
import pytest
from granbridge.core.bus import EventBus
from granbridge.ble.transport import ReplayTransport
from granbridge.ble.connection import ConnectionManager
from granbridge.protocol.segment_map import SegmentMap

async def test_recorded_session_decodes_to_expected_beds():
    frames = [b"8.0@", b"4.0@", b"OUT@"]
    bus = EventBus()
    transport = ReplayTransport(frames=frames, interval_s=0)
    mgr = ConnectionManager(
        transport=transport, bus=bus, name_prefix="REPLAY", service_uuid="svc",
        backoff_base=0.0, backoff_cap=0.0, segment_map=SegmentMap(),
    )
    beds: list[str] = []
    with bus.subscribe() as sub:
        run_task = asyncio.create_task(mgr.run())
        await mgr.wait_connected(timeout=2)
        await transport.play()
        try:
            while len(beds) < 3:
                ev = await asyncio.wait_for(sub.get(), timeout=2)
                if ev.type == "dart_hit":
                    beds.append(ev.bed)
        finally:
            mgr.stop()
            await asyncio.wait_for(run_task, timeout=2)
    assert beds == ["BULL", "DBULL", "MISS"]
