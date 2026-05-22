from __future__ import annotations

from granbridge.events.models import BaseEvent, DartHit, ErrorEvent, Ring
from granbridge.protocol.segment_map import SegmentMap

# ring -> (multiplier, bed_prefix). Bulls/out handled separately.
_RING_RULES: dict[Ring, tuple[int, str]] = {
    Ring.SINGLE_OUTER: (1, "S"),
    Ring.SINGLE_INNER: (1, "S"),
    Ring.DOUBLE: (2, "D"),
    Ring.TRIPLE: (3, "T"),
}


class Decoder:
    """Turns a frame body into a typed event using the segment map."""

    def __init__(self, segment_map: SegmentMap) -> None:
        self._map = segment_map

    def decode(self, body: str) -> BaseEvent:
        raw = f"{body}@"
        info = self._map.lookup(body)
        if info is None:
            return ErrorEvent(
                category="decode",
                message=f"unknown frame: {body!r}",
                recoverable=True,
            )
        ring, number = info

        if ring is Ring.OUT:
            return DartHit(raw=raw, ring=ring, segment=None, multiplier=0, bed="MISS", score=0)
        if ring is Ring.SBULL:
            return DartHit(raw=raw, ring=ring, segment=25, multiplier=1, bed="BULL", score=25)
        if ring is Ring.DBULL:
            return DartHit(raw=raw, ring=ring, segment=25, multiplier=2, bed="DBULL", score=50)

        multiplier, prefix = _RING_RULES[ring]
        assert number is not None  # numbered rings always carry a number
        return DartHit(
            raw=raw,
            ring=ring,
            segment=number,
            multiplier=multiplier,
            bed=f"{prefix}{number}",
            score=number * multiplier,
        )
