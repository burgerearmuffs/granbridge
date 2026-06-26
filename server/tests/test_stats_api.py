# server/tests/test_stats_api.py
import asyncio
import json
import urllib.request
import pytest
import websockets
from granbridge_broker.broker import BrokerServer
from granbridge_broker.stats import StatsStore


async def _start(tmp_path):
    store = StatsStore(tmp_path / "stats.db")
    s = BrokerServer("127.0.0.1", 0, turn_secret="sek", turn_domain="x.test",
                     stats_store=store, stats_rate_per_min=1000)
    await s.start()
    port = s._server.sockets[0].getsockname()[1]
    return s, store, port


def _get_sync(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as r:
        return r.status, json.loads(r.read())


async def _get(port, path):
    """Async wrapper: runs blocking urlopen in a thread so the event loop stays free."""
    return await asyncio.to_thread(_get_sync, port, path)


@pytest.mark.asyncio
async def test_stats_player_read_returns_zeros_for_unknown(tmp_path):
    s, _, port = await _start(tmp_path)
    try:
        status, body = await _get(port, "/stats/player/nobody")
        assert status == 200
        assert body["games_played"] == 0 and body["three_dart_avg"] == 0.0
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_stats_player_read_reflects_a_submitted_match(tmp_path):
    s, store, port = await _start(tmp_path)
    try:
        await asyncio.to_thread(store.submit_match, "P1", "t1", {
            "match_id": "m1", "mode": "x01", "opponent_id": None, "winner_id": "P1",
            "is_remote": False, "darts": 9, "total_scored": 180,
            "started_at": "2026-05-24T10:00:00.000Z", "ended_at": "2026-05-24T10:05:00.000Z",
            "throws": None,
        })
        status, body = await _get(port, "/stats/player/P1")
        assert status == 200 and body["games_played"] == 1 and body["wins"] == 1
        status, lb = await _get(port, "/stats/leaderboard?metric=avg&limit=5")
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
    s, _, port = await _start(tmp_path)
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps(_match_msg()))
            ack = json.loads(await ws.recv())
        assert ack["type"] == "stats_ack" and ack["match_id"] == "m1" and ack["verified"] is False
        _, body = await _get(port, "/stats/player/P1")
        assert body["games_played"] == 1 and body["heatmap"]["T20"] == 1
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_stats_submit_wrong_token_is_rejected(tmp_path):
    s, _, port = await _start(tmp_path)
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps(_match_msg()))
            await ws.recv()  # first ack registers the token
            await ws.send(json.dumps(_match_msg(token="WRONG", match_id="m2")))
            err = json.loads(await ws.recv())
        assert err["type"] == "error" and err["code"] == "token_mismatch"
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_stats_submit_implausible_is_rejected(tmp_path):
    s, _, port = await _start(tmp_path)
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            bad = _match_msg(match_id="m3")
            bad["match"]["total_scored"] = 99999
            await ws.send(json.dumps(bad))
            err = json.loads(await ws.recv())
        assert err["type"] == "error" and err["code"] == "implausible"
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_stats_submit_when_disabled_reports_unsupported(tmp_path):
    s = BrokerServer("127.0.0.1", 0, turn_secret="sek", turn_domain="x.test")  # no stats_store
    await s.start()
    port = s._server.sockets[0].getsockname()[1]
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps(_match_msg()))
            err = json.loads(await ws.recv())
        assert err["type"] == "error" and err["code"] == "unsupported"
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_stats_player_empty_id_is_400(tmp_path):
    s, _, port = await _start(tmp_path)
    try:
        import urllib.error
        try:
            await _get(port, "/stats/player/")
            assert False, "expected HTTP 400"
        except urllib.error.HTTPError as e:
            assert e.code == 400
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_stats_unknown_subpath_is_404(tmp_path):
    s, _, port = await _start(tmp_path)
    try:
        import urllib.error
        try:
            await _get(port, "/stats/bogus")
            assert False, "expected HTTP 404"
        except urllib.error.HTTPError as e:
            assert e.code == 404
    finally:
        await s.stop()


from smoke import check_stats  # noqa: E402


@pytest.mark.asyncio
async def test_smoke_check_stats_round_trip(tmp_path):
    s, _, port = await _start(tmp_path)
    try:
        ok, detail = await check_stats(f"ws://127.0.0.1:{port}", f"http://127.0.0.1:{port}")
        assert ok is True
        assert "stats" in detail
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_stats_submit_unexpected_error_reports_server_error(tmp_path):
    s, store, port = await _start(tmp_path)

    def _boom(*a, **k):
        raise RuntimeError("db exploded")
    store.submit_match = _boom  # force an unexpected (non-Validation/Permission) error
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps(_match_msg()))
            err = json.loads(await ws.recv())
        assert err["type"] == "error" and err["code"] == "server_error"
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_stats_player_overlong_id_is_400(tmp_path):
    s, _, port = await _start(tmp_path)
    try:
        import urllib.error
        try:
            await _get(port, "/stats/player/" + "x" * 200)
            assert False, "expected HTTP 400"
        except urllib.error.HTTPError as e:
            assert e.code == 400
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_stats_submit_rate_limited(tmp_path):
    store = StatsStore(tmp_path / "stats.db")
    s = BrokerServer("127.0.0.1", 0, turn_secret="sek", turn_domain="x.test",
                     stats_store=store, stats_rate_per_min=1)  # 1 submit per minute
    await s.start()
    port = s._server.sockets[0].getsockname()[1]
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps(_match_msg(match_id="m1")))
            ack = json.loads(await ws.recv())
            assert ack["type"] == "stats_ack"
            await ws.send(json.dumps(_match_msg(match_id="m2")))  # 2nd in same window
            err = json.loads(await ws.recv())
        assert err["type"] == "error" and err["code"] == "rate_limited"
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_player_matches_route_not_swallowed_by_bare_route(tmp_path):
    s, store, port = await _start(tmp_path)
    try:
        await asyncio.to_thread(store.submit_match, "P1", "t1", {
            "match_id": "m1", "mode": "x01", "opponent_id": "P2", "winner_id": "P1",
            "is_remote": True, "darts": 9, "total_scored": 180,
            "started_at": "2026-05-24T10:00:00.000Z", "ended_at": None, "throws": None,
        })
        status, body = await _get(port, "/stats/player/P1/matches")
        assert status == 200
        assert "matches" in body and "games_played" not in body   # NOT a player_summary
        assert body["player_id"] == "P1"
        assert body["matches"][0]["match_id"] == "m1"
        assert body["matches"][0]["won"] is True
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_h2h_route_returns_tally(tmp_path):
    s, store, port = await _start(tmp_path)
    try:
        await asyncio.to_thread(store.submit_match, "A", "ta", {
            "match_id": "g1", "mode": "x01", "opponent_id": "B", "winner_id": "A",
            "is_remote": True, "darts": 9, "total_scored": 180,
            "started_at": "2026-05-24T10:00:00.000Z", "ended_at": None, "throws": None})
        await asyncio.to_thread(store.submit_match, "B", "tb", {
            "match_id": "g1", "mode": "x01", "opponent_id": "A", "winner_id": "A",
            "is_remote": True, "darts": 9, "total_scored": 100,
            "started_at": "2026-05-24T10:00:00.000Z", "ended_at": None, "throws": None})
        status, body = await _get(port, "/stats/h2h/A/B")
        assert status == 200
        assert body["games"] == 1 and body["a_wins"] == 1 and body["b_wins"] == 0
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_h2h_missing_second_id_is_400_or_404(tmp_path):
    s, _, port = await _start(tmp_path)
    try:
        import urllib.error
        try:
            await _get(port, "/stats/h2h/A")
            assert False, "expected an HTTP error"
        except urllib.error.HTTPError as e:
            assert e.code in (400, 404)
    finally:
        await s.stop()


def _profile_msg(player_id="P1", token="t1", name="Ann", bio="hi there"):
    return {
        "type": "profile_update", "id": player_id, "writeToken": token,
        "player": {"id": player_id, "name": name, "avatar": {"color": "#f00"}, "bio": bio},
    }


@pytest.mark.asyncio
async def test_profile_update_over_ws_then_read_back(tmp_path):
    s, _, port = await _start(tmp_path)
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps(_profile_msg(bio="bullseye fan")))
            ack = json.loads(await ws.recv())
        assert ack["type"] == "profile_ack" and ack["id"] == "P1" and ack["bio"] == "bullseye fan"
        _, body = await _get(port, "/stats/player/P1")
        assert body["bio"] == "bullseye fan" and body["games_played"] == 0
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_profile_update_wrong_token_rejected(tmp_path):
    s, _, port = await _start(tmp_path)
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps(_profile_msg()))
            await ws.recv()  # registers token
            await ws.send(json.dumps(_profile_msg(token="WRONG", bio="x")))
            err = json.loads(await ws.recv())
        assert err["type"] == "error" and err["code"] == "token_mismatch"
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_profile_update_overlong_bio_is_implausible(tmp_path):
    s, _, port = await _start(tmp_path)
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps(_profile_msg(bio="x" * 161)))
            err = json.loads(await ws.recv())
        assert err["type"] == "error" and err["code"] == "implausible"
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_profile_update_when_disabled_unsupported(tmp_path):
    s = BrokerServer("127.0.0.1", 0, turn_secret="sek", turn_domain="x.test")  # no stats_store
    await s.start()
    port = s._server.sockets[0].getsockname()[1]
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps(_profile_msg()))
            err = json.loads(await ws.recv())
        assert err["type"] == "error" and err["code"] == "unsupported"
    finally:
        await s.stop()
