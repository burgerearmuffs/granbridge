from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from granbridge.events.models import Ring

# Full GRANBOARD `row.col` -> segment table.
#
# Sourced from community reverse-engineering (GranBoard-with-Autodarts) and VALIDATED against
# live GRANBOARD 3s hardware on 2026-05-22 — every spot-checked code matched: 3.5=S20(outer),
# 3.3=S20(inner), 3.6=D20, 3.4=T20, 7.2=S3(outer), 7.1=S3(inner), 8.4=D3, 7.0=T3, 8.0=BULL,
# 4.0=DBULL. The board sends nothing for misses (no out-zone sensors), so "OUT" is reserved but
# rarely emitted; missed darts are handled by the manual `record_miss` command instead.
#
# Per number: (single_outer, single_inner, double, triple) raw codes (without the trailing '@').
_NUMBERS: dict[int, tuple[str, str, str, str]] = {
    1: ("2.5", "2.3", "2.6", "2.4"),
    2: ("9.2", "9.1", "8.2", "9.0"),
    3: ("7.2", "7.1", "8.4", "7.0"),
    4: ("0.5", "0.1", "0.6", "0.3"),
    5: ("5.4", "5.1", "4.6", "5.2"),
    6: ("1.3", "1.0", "4.4", "1.1"),
    7: ("11.4", "11.1", "8.6", "11.2"),
    8: ("6.5", "6.2", "6.6", "6.4"),
    9: ("9.5", "9.3", "9.6", "9.4"),
    10: ("2.2", "2.0", "4.3", "2.1"),
    11: ("7.5", "7.3", "7.6", "7.4"),
    12: ("5.5", "5.0", "5.6", "5.3"),
    13: ("0.4", "0.0", "4.5", "0.2"),
    14: ("10.5", "10.3", "10.6", "10.4"),
    15: ("3.2", "3.0", "4.2", "3.1"),
    16: ("11.5", "11.0", "11.6", "11.3"),
    17: ("10.2", "10.1", "8.3", "10.0"),
    18: ("1.5", "1.2", "1.6", "1.4"),
    19: ("6.3", "6.1", "8.5", "6.0"),
    20: ("3.5", "3.3", "3.6", "3.4"),
}


def _build_seed() -> dict[str, tuple[Ring, Optional[int]]]:
    seed: dict[str, tuple[Ring, Optional[int]]] = {}
    for number, (so, si, double, treble) in _NUMBERS.items():
        seed[so] = (Ring.SINGLE_OUTER, number)
        seed[si] = (Ring.SINGLE_INNER, number)
        seed[double] = (Ring.DOUBLE, number)
        seed[treble] = (Ring.TRIPLE, number)
    seed["8.0"] = (Ring.SBULL, 25)
    seed["4.0"] = (Ring.DBULL, 50)
    seed["OUT"] = (Ring.OUT, None)
    return seed


_SEED: dict[str, tuple[Ring, Optional[int]]] = _build_seed()


class SegmentMap:
    """Maps a GRANBOARD frame body (e.g. '12.3') to (ring, number).

    Overrides (from `granbridge calibrate`, for a board that deviates from the standard table)
    take precedence over the seed.
    """

    def __init__(
        self,
        seed: Optional[dict[str, tuple[Ring, Optional[int]]]] = None,
        overrides: Optional[dict[str, tuple[Ring, Optional[int]]]] = None,
    ) -> None:
        self._seed = dict(seed if seed is not None else _SEED)
        self._overrides: dict[str, tuple[Ring, Optional[int]]] = dict(overrides or {})

    def lookup(self, body: str) -> Optional[tuple[Ring, Optional[int]]]:
        if body in self._overrides:
            return self._overrides[body]
        return self._seed.get(body)

    def set_override(self, body: str, ring: Ring, number: Optional[int]) -> None:
        self._overrides[body] = (ring, number)

    def save(self, path: Path) -> None:
        payload = {
            body: {"ring": ring.value, "number": number}
            for body, (ring, number) in self._overrides.items()
        }
        Path(path).write_text(json.dumps(payload, indent=2))

    @classmethod
    def load(cls, path: Path) -> "SegmentMap":
        overrides: dict[str, tuple[Ring, Optional[int]]] = {}
        p = Path(path)
        if p.exists():
            raw = json.loads(p.read_text())
            for body, entry in raw.items():
                overrides[body] = (Ring(entry["ring"]), entry["number"])
        return cls(overrides=overrides)
