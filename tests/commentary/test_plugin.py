from granbridge.commentary.plugin import CommentaryPlugin
from granbridge.commentary.events import Commentary
from granbridge.events.models import DartHit, Ring
from granbridge.game.events import GameWon

def _hit(bed, score): return DartHit(raw=f"{bed}@", ring=Ring.TRIPLE, segment=20, multiplier=3, bed=bed, score=score)

async def test_publishes_commentary_for_game_won():
    out = []
    async def publish(ev): out.append(ev)
    p = CommentaryPlugin({}, publish=publish)
    await p.handle(GameWon(player="Ann"))
    assert out and isinstance(out[0], Commentary) and "wins" in out[0].text

async def test_detects_180():
    out = []
    async def publish(ev): out.append(ev)
    p = CommentaryPlugin({}, publish=publish)
    for _ in range(3):
        await p.handle(_hit("T20", 60))
    assert any("180" in e.text or "eighty" in e.text.lower() for e in out)

async def test_ignores_commentary_events():
    out = []
    async def publish(ev): out.append(ev)
    p = CommentaryPlugin({}, publish=publish)
    await p.handle(Commentary(text="x"))
    assert out == []
