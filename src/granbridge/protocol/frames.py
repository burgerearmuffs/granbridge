from __future__ import annotations

import re
import time
from typing import Callable, Optional

TERMINATOR = "@"

# GRANBOARD sends a one-time connect handshake like "GB7;101" / "GB8;102" with NO '@' terminator,
# so it buffers and glues onto the first real frame ("GB7;1013.5"). Strip a leading handshake of the
# form GB<digit>;<3 digits>. (Exactly 3 digits so it doesn't eat into the following "row.col".)
_HANDSHAKE = re.compile(r"^GB\d;\d{3}")


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

    def reset(self) -> None:
        """Clear buffered partial frames and dedup state.

        Call on every (re)connect so a fragment left over from a dropped session
        is not prepended to the next session's first bytes, and so the dedup
        window does not suppress the first throw after reconnecting.
        """
        self._buf = ""
        self._last_body = None
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
                body = body[len(prefix):]
                break
        return _HANDSHAKE.sub("", body)

    def _is_duplicate(self, body: str) -> bool:
        now = self._clock()
        if body == self._last_body and (now - self._last_time) < self._dedup_window_s:
            return True
        self._last_body = body
        self._last_time = now
        return False
