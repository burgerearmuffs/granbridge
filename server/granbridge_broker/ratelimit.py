"""In-process rate limiting (zero deps) for the public broker endpoints.

RateLimiter is a sliding-window counter keyed by an arbitrary string (client IP
or peer id). limit <= 0 disables it (always allows). The clock is passed in so
callers (and tests) stay deterministic.
"""
from __future__ import annotations

from collections import deque
from typing import Optional


class RateLimiter:
    def __init__(self, limit: int, window: float) -> None:
        self._limit = limit
        self._window = window
        self._events: dict[str, deque[float]] = {}

    def allow(self, key: str, now: float) -> bool:
        if self._limit <= 0:
            return True
        dq = self._events.get(key)
        if dq is None:
            dq = deque()
            self._events[key] = dq
        cutoff = now - self._window
        while dq and dq[0] <= cutoff:
            dq.popleft()
        if len(dq) >= self._limit:
            return False
        dq.append(now)
        return True

    def prune(self, now: float) -> None:
        """Drop keys whose events have all aged out (bounds memory)."""
        cutoff = now - self._window
        for key in list(self._events):
            dq = self._events[key]
            while dq and dq[0] <= cutoff:
                dq.popleft()
            if not dq:
                del self._events[key]

    def key_count(self) -> int:
        return len(self._events)


def client_ip(headers, remote_address: Optional[tuple]) -> str:
    """Resolve the client IP. Prefer X-Real-IP (set authoritatively by Caddy);
    fall back to the socket peer host, then 'unknown'. Works with any object
    exposing .get (websockets Headers or a plain dict)."""
    xri = headers.get("X-Real-IP")
    if xri:
        return xri.split(",")[0].strip()
    if remote_address:
        return remote_address[0]
    return "unknown"
