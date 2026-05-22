from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from granbridge.events.models import Ring

# Seeded from community reverse-engineering. Only high-confidence anchors are
# included; the full row.col grid is completed live via `granbridge calibrate`.
_SEED: dict[str, tuple[Ring, Optional[int]]] = {
    "8.0": (Ring.SBULL, 25),
    "4.0": (Ring.DBULL, 50),
    "OUT": (Ring.OUT, None),
}


class SegmentMap:
    """Maps a GRANBOARD frame body (e.g. '12.3') to (ring, number).

    Overrides (from calibration) take precedence over the seed table.
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
