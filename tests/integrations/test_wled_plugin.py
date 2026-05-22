from granbridge.integrations.plugins.wled_plugin import WledPlugin
from granbridge.game.events import GameWon, Bust

async def test_game_won_posts_celebration():
    calls = []
    async def poster(url, payload): calls.append((url, payload))
    p = WledPlugin({"host": "1.2.3.4", "win_fx": 80}, poster=poster)
    await p.handle(GameWon(player="Ann"))
    assert calls[0][0] == "http://1.2.3.4/json/state"
    assert calls[0][1]["seg"][0]["fx"] == 80

async def test_bust_posts_red_flash():
    calls = []
    async def poster(url, payload): calls.append((url, payload))
    p = WledPlugin({"host": "1.2.3.4"}, poster=poster)
    await p.handle(Bust(player="p1", score_attempted=10, reason="bust"))
    assert calls and calls[0][1]["on"] is True

async def test_no_host_is_noop():
    calls = []
    async def poster(url, payload): calls.append(1)
    p = WledPlugin({}, poster=poster)
    await p.handle(GameWon(player="Ann"))
    assert calls == []
