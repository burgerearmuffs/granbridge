# server/tests/test_stats_api.py
import asyncio
import json
import urllib.request
import pytest
import websockets
from granbridge_broker.broker import BrokerServer
from granbridge_broker.stats import StatsStore


async def _start(tmp_path, port):
    store = StatsStore(tmp_path / "stats.db")
    s = BrokerServer("127.0.0.1", port, turn_secret="sek", turn_domain="x.test",
                     stats_store=store, stats_rate_per_min=1000)
    await s.start()
    return s, store


def _get_sync(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as r:
        return r.status, json.loads(r.read())


async def _get(port, path):
    """Async wrapper: runs blocking urlopen in a thread so the event loop stays free."""
    return await asyncio.to_thread(_get_sync, port, path)


@pytest.mark.asyncio
async def test_stats_player_read_returns_zeros_for_unknown(tmp_path):
    s, _ = await _start(tmp_path, 8801)
    try:
        status, body = await _get(8801, "/stats/player/nobody")
        assert status == 200
        assert body["games_played"] == 0 and body["three_dart_avg"] == 0.0
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_stats_player_read_reflects_a_submitted_match(tmp_path):
    s, store = await _start(tmp_path, 8802)
    try:
        store.submit_match("P1", "t1", {
            "match_id": "m1", "mode": "x01", "opponent_id": None, "winner_id": "P1",
            "is_remote": False, "darts": 9, "total_scored": 180,
            "started_at": "2026-05-24T10:00:00.000Z", "ended_at": "2026-05-24T10:05:00.000Z",
            "throws": None,
        })
        status, body = await _get(8802, "/stats/player/P1")
        assert status == 200 and body["games_played"] == 1 and body["wins"] == 1
        status, lb = await _get(8802, "/stats/leaderboard?metric=avg&limit=5")
        assert status == 200 and lb["metric"] == "avg" and isinstance(lb["players"], list)
    finally:
        await s.stop()


def _match_msg(player_id="P1", token="t1", match_id="m1", winner="P1", name="Ann"):
    return {
        "type": "stats_submit", "id": player_id, "writeToken": token,
        "player": {"id": player_id, "name": name, "avatar": {"color": "#f00"}},
        "match": {
            "match_id": match_id, "mode": "x01", "opponent_id": None, "winner_id": winner,
            "is_remote": False, "darts": 9, "total_scored": 180,
            "started_at": "2026-05-24T10:00:00.000Z", "ended_at": "2026-05-24T10:05:00.000Z",
            "throws": [{"bed": "T20", "score": 60, "ts": "2026-05-24T10:00:01.000Z"}],
        },
    }


@pytest.mark.asyncio
async def test_stats_submit_over_ws_then_read_back(tmp_path):
    s, _ = await _start(tmp_path, 8803)
    try:
        async with websockets.connect("ws://127.0.0.1:8803") as ws:
            await ws.send(json.dumps(_match_msg()))
            ack = json.loads(await ws.recv())
        assert ack["type"] == "stats_ack" and ack["match_id"] == "m1" and ack["verified"] is False
        _, body = await _get(8803, "/stats/player/P1")
        assert body["games_played"] == 1 and body["heatmap"]["T20"] == 1
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_stats_submit_wrong_token_is_rejected(tmp_path):
    s, _ = await _start(tmp_path, 8804)
    try:
        async with websockets.connect("ws://127.0.0.1:8804") as ws:
            await ws.send(json.dumps(_match_msg()))
            await ws.recv()  # first ack registers the token
            await ws.send(json.dumps(_match_msg(token="WRONG", match_id="m2")))
            err = json.loads(await ws.recv())
        assert err["type"] == "error" and err["code"] == "token_mismatch"
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_stats_submit_implausible_is_rejected(tmp_path):
    s, _ = await _start(tmp_path, 8805)
    try:
        async with websockets.connect("ws://127.0.0.1:8805") as ws:
            bad = _match_msg(match_id="m3")
            bad["match"]["total_scored"] = 99999
            await ws.send(json.dumps(bad))
            err = json.loads(await ws.recv())
        assert err["type"] == "error" and err["code"] == "implausible"
    finally:
        await s.stop()
