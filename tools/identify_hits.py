"""Heuristic classifier for captured GRANBOARD frame bodies."""
from __future__ import annotations

import re

_COORD = re.compile(r"^\d+\.\d+$")


def classify_frame(body: str) -> str:
    """Return 'hit', 'button', or 'other' for a frame body (no '@')."""
    if body == "OUT":
        return "button"
    if _COORD.match(body):
        return "hit"
    return "other"
