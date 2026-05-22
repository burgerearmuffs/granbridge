from __future__ import annotations
from typing import Literal
from granbridge.events.models import BaseEvent

class Commentary(BaseEvent):
    type: Literal["commentary"] = "commentary"
    text: str
    tone: str = "play-by-play"
