from __future__ import annotations
from typing import Awaitable, Callable, Optional
from granbridge.events.models import BaseEvent
from granbridge.integrations.base import Plugin
from granbridge.commentary.commentator import Commentator, TemplateCommentator
from granbridge.commentary.events import Commentary

Publish = Callable[[BaseEvent], Awaitable[None]]

class CommentaryPlugin(Plugin):
    """Generates commentary lines and publishes them as `commentary` events.
    The one plugin allowed to publish (via injected `publish`); never comments on its own output.
    Also detects a 180 across a 3-dart visit."""
    name = "commentary"
    def __init__(self, config: dict, commentator: Optional[Commentator] = None,
                 publish: Optional[Publish] = None) -> None:
        super().__init__(config)
        self._commentator = commentator or TemplateCommentator()
        self._publish = publish
        self._visit: list[int] = []

    def set_publish(self, publish: Publish) -> None:
        self._publish = publish

    async def handle(self, event: BaseEvent) -> None:
        if event.type == "commentary" or self._publish is None:
            return
        line: Optional[str] = None
        if event.type == "dart_hit":
            self._visit.append(getattr(event, "score", 0))
            if len(self._visit) >= 3:
                if sum(self._visit[-3:]) == 180:
                    line = "One hundred and eighty!"
                self._visit = []
        if line is None:
            line = self._commentator.comment(event)
        if line:
            await self._publish(Commentary(text=line))
