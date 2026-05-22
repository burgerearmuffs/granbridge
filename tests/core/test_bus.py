import asyncio
import pytest
from granbridge.core.bus import EventBus
from granbridge.events.models import DartHit, Ring, ConnectionState

def _hit():
    return DartHit(raw="8.0@", ring=Ring.SBULL, segment=25, multiplier=1, bed="BULL", score=25)

async def test_subscriber_receives_published_event():
    bus = EventBus()
    with bus.subscribe() as sub:
        await bus.publish(_hit())
        event = await asyncio.wait_for(sub.get(), timeout=1)
        assert event.type == "dart_hit"

async def test_two_subscribers_both_receive():
    bus = EventBus()
    with bus.subscribe() as a, bus.subscribe() as b:
        await bus.publish(_hit())
        ea = await asyncio.wait_for(a.get(), timeout=1)
        eb = await asyncio.wait_for(b.get(), timeout=1)
        assert ea.score == eb.score == 25

async def test_snapshot_returns_last_event_per_type():
    bus = EventBus()
    await bus.publish(ConnectionState(state="connected"))
    await bus.publish(_hit())
    types = {e.type for e in bus.snapshot()}
    assert types == {"connection_state", "dart_hit"}

async def test_unsubscribe_on_exit_stops_delivery():
    bus = EventBus()
    with bus.subscribe() as sub:
        pass
    await bus.publish(_hit())
    assert sub.empty()
