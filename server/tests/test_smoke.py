import asyncio, pytest
import smoke  # server/ is on sys.path via server/conftest.py
from granbridge_broker.broker import BrokerServer


def test_http_base_mapping():
    assert smoke._http_base("wss://play.example.com") == "https://play.example.com"
    assert smoke._http_base("ws://127.0.0.1:8788") == "http://127.0.0.1:8788"
    assert smoke._http_base("wss://d/") == "https://d"


@pytest.fixture
async def server():
    s = BrokerServer("127.0.0.1", 8798, turn_secret="sek", turn_domain="play.example.com")
    await s.start()
    yield s
    await s.stop()


async def test_checks_pass_against_local_broker(server):
    base = "http://127.0.0.1:8798"
    ok_h, detail_h = await asyncio.to_thread(smoke.check_health, base)
    assert ok_h, detail_h
    ok_t, detail_t = await asyncio.to_thread(smoke.check_turn, base)
    assert ok_t, detail_t
    ok_w, detail_w = await smoke.check_ws("ws://127.0.0.1:8798")
    assert ok_w, detail_w


async def test_health_fails_on_dead_endpoint():
    ok, _ = await asyncio.to_thread(smoke.check_health, "http://127.0.0.1:9")
    assert ok is False


def test_http_base_rejects_missing_scheme():
    with pytest.raises(ValueError):
        smoke._http_base("naked-host")


def test_http_base_prefix_based_for_ws_in_hostname():
    assert smoke._http_base("ws://wsserver.example.com") == "http://wsserver.example.com"


async def test_ws_check_skips_without_websockets(monkeypatch):
    import sys
    monkeypatch.setitem(sys.modules, "websockets", None)  # forces ImportError on `import websockets`
    ok, detail = await smoke.check_ws("ws://127.0.0.1:8798")
    assert ok is None and "SKIP" in detail
