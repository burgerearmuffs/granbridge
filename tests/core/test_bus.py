import asyncio
import pytest
from granbridge.core.bus import EventBus, Subscription
from granbridge.events.models import DartHit, Ring, ConnectionState

def _hit(score: int = 25) -> DartHit:
    return DartHit(raw="8.0@", ring=Ring.SBULL, segment=25, multiplier=1, bed="BULL", score=score)

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


# ---- bounded-queue tests ----

async def test_bounded_queue_never_exceeds_maxsize():
    """Publishing more events than maxsize must not grow the queue beyond maxsize."""
    bus = EventBus()
    maxsize = 3
    sub = Subscription(bus, maxsize=maxsize)
    bus._add(sub)
    try:
        for i in range(maxsize + 5):
            await bus.publish(_hit(score=i))
        # Queue must be exactly maxsize (never larger)
        assert sub._queue.qsize() == maxsize
    finally:
        bus._remove(sub)


async def test_bounded_queue_retains_newest_events():
    """When the queue overflows, the OLDEST events are dropped; the newest survive."""
    bus = EventBus()
    maxsize = 3
    sub = Subscription(bus, maxsize=maxsize)
    bus._add(sub)
    try:
        # Publish 6 events with scores 0-5; only the last 3 (scores 3,4,5) should remain
        for i in range(6):
            await bus.publish(_hit(score=i))

        retained_scores = []
        while not sub.empty():
            event = await asyncio.wait_for(sub.get(), timeout=1)
            retained_scores.append(event.score)

        assert retained_scores == [3, 4, 5], f"Expected newest events [3,4,5], got {retained_scores}"
    finally:
        bus._remove(sub)


async def test_bounded_queue_via_subscribe_param():
    """bus.subscribe(maxsize=N) wires through correctly."""
    bus = EventBus()
    with bus.subscribe(maxsize=2) as sub:
        for i in range(5):
            await bus.publish(_hit(score=i))
        assert sub._queue.qsize() == 2
        # Only the two newest remain
        e1 = await asyncio.wait_for(sub.get(), timeout=1)
        e2 = await asyncio.wait_for(sub.get(), timeout=1)
        assert [e1.score, e2.score] == [3, 4]
