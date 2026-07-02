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


from smoke import turns_endpoint, recv_stun_message


def test_turns_endpoint_parses_host_and_port():
    uris = ["turns:play.example.com:443?transport=tcp"]
    assert turns_endpoint(uris) == ("play.example.com", 443)


def test_turns_endpoint_returns_none_for_non_turns():
    assert turns_endpoint(["turn:play.example.com:3478?transport=udp"]) is None
    assert turns_endpoint([]) is None


class _FakeSock:
    """Feeds a fixed byte buffer to recv() in small chunks."""
    def __init__(self, data: bytes):
        self._buf = data
    def recv(self, n: int) -> bytes:
        chunk, self._buf = self._buf[:n], self._buf[n:]
        return chunk


def test_recv_stun_message_reads_header_plus_body():
    import struct, os
    body = b"\x00\x19\x00\x04\x11\x00\x00\x00"  # one 8-byte attribute
    txn = os.urandom(12)
    msg = struct.pack(">HHI", 0x0103, len(body), 0x2112A442) + txn + body
    # extra trailing bytes must NOT be consumed
    sock = _FakeSock(msg + b"TRAILING")
    out = recv_stun_message(sock)
    assert out == msg


def test_wss_ssl_context_advertises_http11_alpn():
    # The 443 demux routes TLS by ALPN: no ALPN → coturn, http/1.1 → broker.
    # Browsers always send ALPN; the smoke client must too or WSS false-fails.
    ctx = smoke._wss_ssl_context("wss://play.example.com")
    assert ctx is not None
    # ssl.SSLContext doesn't expose the configured protos; monkey-level check:
    # set_alpn_protocols was called iff our sentinel records it.
    assert getattr(ctx, "_granbridge_alpn", None) == ["http/1.1"]


def test_wss_ssl_context_none_for_plain_ws():
    assert smoke._wss_ssl_context("ws://127.0.0.1:8798") is None
