from granbridge.integrations.plugins.discord_plugin import DiscordWebhookPlugin
from granbridge.game.events import GameWon, LegWon
from granbridge.events.models import DartHit, Ring

async def test_game_won_posts_to_webhook():
    calls = []
    async def poster(url, payload): calls.append((url, payload))
    p = DiscordWebhookPlugin({"webhook_url": "https://hook"}, poster=poster)
    await p.handle(GameWon(player="Ann"))
    assert calls and calls[0][0] == "https://hook" and "Ann" in calls[0][1]["content"]

async def test_dart_hit_does_nothing():
    calls = []
    async def poster(url, payload): calls.append(1)
    p = DiscordWebhookPlugin({"webhook_url": "https://hook"}, poster=poster)
    await p.handle(DartHit(raw="T20@", ring=Ring.TRIPLE, segment=20, multiplier=3, bed="T20", score=60))
    assert calls == []

async def test_no_url_is_noop():
    calls = []
    async def poster(url, payload): calls.append(1)
    p = DiscordWebhookPlugin({}, poster=poster)
    await p.handle(GameWon(player="Ann"))
    assert calls == []
