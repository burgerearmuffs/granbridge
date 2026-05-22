from __future__ import annotations

import time
from typing import Callable, Optional

TERMINATOR = "@"


class FrameAssembler:
    """Reassembles a BLE byte stream into complete, de-duplicated frame bodies.

    Frames are ASCII text terminated by '@'. Known connection prefixes are
    stripped. Identical consecutive frames inside `dedup_window_s` are dropped.
    """

    def __init__(
        self,
        prefixes: tuple[str, ...] = ("GB8;102",),
        dedup_window_s: float = 0.05,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._prefixes = prefixes
        self._dedup_window_s = dedup_window_s
        self._clock = clock
        self._buf = ""
        self._last_body: Optional[str] = None
        self._last_time = float("-inf")

    def feed(self, data: bytes) -> list[str]:
        self._buf += data.decode("ascii", errors="ignore")
        out: list[str] = []
        while TERMINATOR in self._buf:
            body, self._buf = self._buf.split(TERMINATOR, 1)
            body = self._strip_prefixes(body).strip()
            if not body:
                continue
            if self._is_duplicate(body):
                continue
            out.append(body)
        return out

    def _strip_prefixes(self, body: str) -> str:
        for prefix in self._prefixes:
            if body.startswith(prefix):
                return body[len(prefix):]
        return body

    def _is_duplicate(self, body: str) -> bool:
        now = self._clock()
        if body == self._last_body and (now - self._last_time) < self._dedup_window_s:
            return True
        self._last_body = body
        self._last_time = now
        return False
