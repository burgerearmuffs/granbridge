from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Callable, Optional
from granbridge.events.models import BaseEvent

class Commentator(ABC):
    @abstractmethod
    def comment(self, event: BaseEvent) -> Optional[str]:
        ...

_BED_LINES = {"T20": "Treble twenty!", "T19": "Treble nineteen!",
              "BULL": "Bullseye!", "DBULL": "Double bull!", "MISS": "Off the board!"}

class TemplateCommentator(Commentator):
    """Offline, rule-based commentary."""
    def comment(self, event: BaseEvent) -> Optional[str]:
        t = event.type
        if t == "dart_hit":
            return _BED_LINES.get(getattr(event, "bed", ""), None)
        if t == "bust":
            return "No score — bust!"
        if t == "leg_won":
            return f"{getattr(event, 'player', 'Player')} takes the leg!"
        if t == "game_won":
            return f"Game shot! {getattr(event, 'player', 'Player')} wins!"
        return None

class LLMCommentator(Commentator):
    """Seam for LLM-generated commentary. FLAGGED: needs an injected `generate` callable
    backed by an LLM provider + API key; not wired to any provider here."""
    def __init__(self, generate: Optional[Callable[[BaseEvent], Optional[str]]] = None) -> None:
        self._generate = generate
    def comment(self, event: BaseEvent) -> Optional[str]:
        if self._generate is None:
            raise RuntimeError("LLMCommentator needs a `generate` callable (LLM client/API key)")
        return self._generate(event)
