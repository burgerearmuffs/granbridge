import pytest
from granbridge.commentary.commentator import TemplateCommentator, LLMCommentator
from granbridge.events.models import DartHit, ErrorEvent, Ring
from granbridge.game.events import Bust, GameWon

def _hit(bed, score): return DartHit(raw=f"{bed}@", ring=Ring.TRIPLE, segment=20, multiplier=3, bed=bed, score=score)

def test_template_lines():
    c = TemplateCommentator()
    assert c.comment(_hit("T20", 60)) == "Treble twenty!"
    assert c.comment(Bust(player="A", score_attempted=10, reason="bust")) == "No score — bust!"
    assert "wins" in c.comment(GameWon(player="Ann"))
    assert c.comment(_hit("S3", 3)) is None  # uninteresting

def test_llm_requires_generate():
    with pytest.raises(RuntimeError):
        LLMCommentator().comment(_hit("T20", 60))
    assert LLMCommentator(generate=lambda e: "custom").comment(_hit("T20", 60)) == "custom"
