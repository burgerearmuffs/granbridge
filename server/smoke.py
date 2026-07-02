"""server/smoke.py — validate a GRANBRIDGE broker deployment from the client side.

Usage:
    python smoke.py wss://play.example.com
    python smoke.py ws://127.0.0.1:8788 [--legacy-udp]

Checks (no WebRTC/browser needed):
  * GET /healthz                  — broker up, returns status ok
  * GET /turn                     — credential endpoint returns a well-formed payload
  * TURNS relay (TLS/TCP 443)     — authenticated TURN Allocate over TLS/TCP; proves
                                    the 443 ALPN-demux path reaches coturn and coturn
                                    accepts the broker credentials (PRIMARY check)
  * UDP 3478 checks               — SKIPPED in 443-only mode; pass --legacy-udp to
                                    run STUN + relay checks against UDP 3478
  * wss:// connect + join         — WebSocket reachable, room join works (skipped if
                                    the 'websockets' package isn't installed)

Expects the full stack (broker + coturn). The TURN relay check verifies the
credential + allocation flow in-process; a real two-player A/V session (media
relay + game sync) still needs two browsers.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import socket
import ssl as _ssl
import struct
import sys
import urllib.request
from urllib.parse import urlparse


_STUN_MAGIC = 0x2112A442


def build_stun_binding_request() -> bytes:
    """A 20-byte STUN Binding Request (RFC 5389): type, length=0, magic, random txn id."""
    return struct.pack(">HHI", 0x0001, 0, _STUN_MAGIC) + os.urandom(12)


def parse_xor_mapped_address(data: bytes, attr_type: int = 0x0020):
    """Return (ip, port) from a STUN response's XOR-MAPPED-ADDRESS (IPv4), or None.

    Pass attr_type=0x0016 to decode XOR-RELAYED-ADDRESS instead.
    """
    if len(data) < 20:
        return None
    _mtype, mlen, magic = struct.unpack(">HHI", data[:8])
    if magic != _STUN_MAGIC:
        return None
    off, end = 20, min(20 + mlen, len(data))
    while off + 4 <= end:
        atype, alen = struct.unpack(">HH", data[off:off + 4])
        val = data[off + 4:off + 4 + alen]
        if atype == attr_type and len(val) >= 8 and val[1] == 0x01:  # XOR-*-ADDRESS, IPv4
            xport = struct.unpack(">H", val[2:4])[0]
            xaddr = struct.unpack(">I", val[4:8])[0]
            port = xport ^ (_STUN_MAGIC >> 16)
            addr = xaddr ^ _STUN_MAGIC
            ip = ".".join(str((addr >> shift) & 0xFF) for shift in (24, 16, 8, 0))
            return ip, port
        off += 4 + alen + ((4 - alen % 4) % 4)  # advance past value + 4-byte padding
    return None


def check_stun(host: str, port: int = 3478, timeout: float = 5.0) -> tuple[bool, str]:
    """Send one STUN Binding Request over UDP; confirm the TURN server is reachable."""
    if not host:
        return False, "stun: no host"
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        req = build_stun_binding_request()
        sock.sendto(req, (host, port))
        data, _ = sock.recvfrom(2048)
    except socket.timeout:
        return False, f"stun {host}:{port}/udp: timeout (UDP 3478 blocked or coturn down?)"
    except Exception as exc:
        return False, f"stun {host}:{port}/udp: {exc}"
    finally:
        sock.close()
    if len(data) < 20 or data[8:20] != req[8:20]:
        return False, f"stun {host}:{port}/udp: unexpected response"
    mapped = parse_xor_mapped_address(data)
    if mapped:
        return True, f"stun {host}:{port}/udp: reachable (reflexive {mapped[0]}:{mapped[1]})"
    return True, f"stun {host}:{port}/udp: reachable"


_ALLOCATE = 0x0003
_REQUESTED_TRANSPORT_UDP = b"\x11\x00\x00\x00"  # protocol 17 (UDP) + 3 reserved


def _get_attr(data: bytes, want_type: int):
    """Raw value bytes of the first STUN attribute of `want_type`, or None."""
    if len(data) < 20:
        return None
    _mtype, mlen, _magic = struct.unpack(">HHI", data[:8])
    off, end = 20, min(20 + mlen, len(data))
    while off + 4 <= end:
        atype, alen = struct.unpack(">HH", data[off:off + 4])
        if atype == want_type:
            return data[off + 4:off + 4 + alen]
        off += 4 + alen + ((4 - alen % 4) % 4)
    return None


def _stun_attr(atype: int, value: bytes) -> bytes:
    pad = (4 - len(value) % 4) % 4
    return struct.pack(">HH", atype, len(value)) + value + b"\x00" * pad


def _long_term_key(username: str, realm: str, credential: str) -> bytes:
    return hashlib.md5(f"{username}:{realm}:{credential}".encode()).digest()


def _build_initial_allocate(txn: bytes) -> bytes:
    body = _stun_attr(0x0019, _REQUESTED_TRANSPORT_UDP)
    return struct.pack(">HHI", _ALLOCATE, len(body), _STUN_MAGIC) + txn + body


def _build_authed_allocate(txn: bytes, username: str, realm: bytes, nonce: bytes, key: bytes) -> bytes:
    body = (
        _stun_attr(0x0006, username.encode())   # USERNAME
        + _stun_attr(0x0014, realm)             # REALM (echo from 401)
        + _stun_attr(0x0015, nonce)             # NONCE (echo from 401)
        + _stun_attr(0x0019, _REQUESTED_TRANSPORT_UDP)
    )
    # MESSAGE-INTEGRITY: the header Message-Length must already include the 24-byte
    # MI attribute (4 header + 20 value); the HMAC covers header+body (not the MI attr).
    header = struct.pack(">HHI", _ALLOCATE, len(body) + 24, _STUN_MAGIC) + txn
    mi = hmac.new(key, header + body, hashlib.sha1).digest()
    return header + body + struct.pack(">HH", 0x0008, 20) + mi


def check_turn_relay(host: str, port: int, username: str, credential: str,
                     timeout: float = 5.0) -> tuple[bool, str]:
    """Authenticated TURN Allocate: confirms coturn accepts the creds and allocates a relay."""
    if not host:
        return False, "turn relay: no host"
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        txn1 = os.urandom(12)
        sock.sendto(_build_initial_allocate(txn1), (host, port))
        challenge, _ = sock.recvfrom(2048)
        if len(challenge) < 20 or challenge[8:20] != txn1:
            return False, "turn relay: unexpected/stale challenge datagram"
        realm = _get_attr(challenge, 0x0014)
        nonce = _get_attr(challenge, 0x0015)
        if realm is None or nonce is None:
            mt = struct.unpack(">H", challenge[:2])[0]
            return False, f"turn relay: no realm/nonce in challenge (msg type {hex(mt)})"
        key = _long_term_key(username, realm.decode("utf-8", "replace"), credential)
        txn2 = os.urandom(12)
        sock.sendto(_build_authed_allocate(txn2, username, realm, nonce, key), (host, port))
        reply, _ = sock.recvfrom(2048)
        if len(reply) < 20 or reply[8:20] != txn2:
            return False, "turn relay: unexpected/stale reply datagram"
        mtype = struct.unpack(">H", reply[:2])[0]
        if mtype == 0x0103:  # Allocate Success
            relayed = parse_xor_mapped_address(reply, 0x0016)  # XOR-RELAYED-ADDRESS
            if relayed:
                return True, f"turn relay: coturn accepted creds, relay allocated {relayed[0]}:{relayed[1]}"
            return True, "turn relay: coturn accepted creds (allocate succeeded)"
        if mtype == 0x0113:  # Allocate Error
            return False, "turn relay: coturn rejected the credentials (error response)"
        return False, f"turn relay: unexpected response type {hex(mtype)}"
    except socket.timeout:
        return False, f"turn relay {host}:{port}/udp: timeout"
    except Exception as exc:
        return False, f"turn relay: {exc}"
    finally:
        sock.close()


def turns_endpoint(uris) -> "tuple[str, int] | None":
    """Extract (host, port) from the first turns: URI in a /turn payload, else None."""
    for uri in uris or []:
        if isinstance(uri, str) and uri.startswith("turns:"):
            rest = uri[len("turns:"):].split("?", 1)[0]   # host:port
            if ":" in rest:
                host, port = rest.rsplit(":", 1)
                try:
                    return host, int(port)
                except ValueError:
                    return None
    return None


def recv_stun_message(sock) -> bytes:
    """Read exactly one STUN message (20-byte header + declared body) from a stream."""
    header = b""
    while len(header) < 20:
        chunk = sock.recv(20 - len(header))
        if not chunk:
            raise ConnectionError("closed before STUN header")
        header += chunk
    _mtype, mlen, magic = struct.unpack(">HHI", header[:8])
    if magic != _STUN_MAGIC:
        raise ValueError("not a STUN message (bad magic cookie)")
    if mlen > 4096:  # real STUN/TURN messages are tiny; guards a misrouted non-STUN endpoint
        raise ValueError(f"implausible STUN length {mlen}")
    body = b""
    while len(body) < mlen:
        chunk = sock.recv(mlen - len(body))
        if not chunk:
            raise ConnectionError("closed before STUN body")
        body += chunk
    return header + body


def check_turns_tcp_relay(host: str, port: int, username: str, credential: str,
                          timeout: float = 8.0, ssl_context=None) -> tuple[bool, str]:
    """Authenticated TURN Allocate over TLS/TCP (turns://). Proves the 443 path:
    a non-HTTP ALPN handshake reaches coturn, which accepts broker creds and
    allocates a relay. This is the primary 443-only validation. Pass an explicit
    ssl_context (e.g. unverified) to test against a self-signed cert."""
    if not host:
        return False, "turns relay: no host"
    ctx = ssl_context or _ssl.create_default_context()
    raw = socket.create_connection((host, port), timeout=timeout)
    try:
        sock = ctx.wrap_socket(raw, server_hostname=host)
        sock.settimeout(timeout)
        txn1 = os.urandom(12)
        sock.sendall(_build_initial_allocate(txn1))
        challenge = recv_stun_message(sock)
        if challenge[8:20] != txn1:
            return False, "turns relay: unexpected/stale challenge"
        realm = _get_attr(challenge, 0x0014)
        nonce = _get_attr(challenge, 0x0015)
        if realm is None or nonce is None:
            return False, "turns relay: no realm/nonce in challenge"
        key = _long_term_key(username, realm.decode("utf-8", "replace"), credential)
        txn2 = os.urandom(12)
        sock.sendall(_build_authed_allocate(txn2, username, realm, nonce, key))
        reply = recv_stun_message(sock)
        if reply[8:20] != txn2:
            return False, "turns relay: unexpected/stale reply"
        mtype = struct.unpack(">H", reply[:2])[0]
        if mtype == 0x0103:
            relayed = parse_xor_mapped_address(reply, 0x0016)
            loc = f" {relayed[0]}:{relayed[1]}" if relayed else ""
            return True, f"turns relay (TCP {port}): coturn accepted creds, relay allocated{loc}"
        if mtype == 0x0113:
            return False, f"turns relay (TCP {port}): coturn rejected the credentials"
        return False, f"turns relay (TCP {port}): unexpected response type {hex(mtype)}"
    except Exception as exc:
        return False, f"turns relay {host}:{port}/tcp: {exc}"
    finally:
        raw.close()


def _http_base(ws_url: str) -> str:
    if "://" not in ws_url:
        raise ValueError(f"URL missing scheme (expected ws:// or wss://): {ws_url!r}")
    scheme = "https" if ws_url.startswith("wss") else "http"
    return (scheme + ws_url[ws_url.index("://"):]).rstrip("/")


def check_health(http_base: str) -> tuple[bool, str]:
    try:
        with urllib.request.urlopen(http_base + "/healthz", timeout=5) as resp:
            data = json.loads(resp.read())
        ok = data.get("status") == "ok"
        return ok, f"/healthz: status={data.get('status')} rooms={data.get('rooms')} peers={data.get('peers')}"
    except Exception as exc:
        return False, f"/healthz: {exc}"


def _fetch_turn(http_base: str, timeout: float = 5.0) -> dict:
    with urllib.request.urlopen(http_base + "/turn", timeout=timeout) as resp:
        return json.loads(resp.read())


def check_turn(http_base: str) -> tuple[bool, str]:
    try:
        data = _fetch_turn(http_base)
        ok = (
            isinstance(data.get("uris"), list) and bool(data["uris"])
            and isinstance(data.get("username"), str) and bool(data["username"])
            and isinstance(data.get("credential"), str) and bool(data["credential"])
        )
        return ok, (
            f"/turn: username={'set' if data.get('username') else 'MISSING'} "
            f"credential={'set' if data.get('credential') else 'MISSING'} "
            f"uris={data.get('uris')}"
        )
    except Exception as exc:
        return False, f"/turn: {exc}"


def _wss_ssl_context(ws_url: str):
    """SSL context for wss:// smoke connects, or None for plain ws://.

    The 443-only deployment demuxes TLS by ALPN: ClientHellos advertising
    http/1.1 (every browser) go to the broker; anything else falls through to
    coturn. Python's default context sends NO ALPN, so without this the WSS
    and stats checks land on coturn and false-fail on a healthy deployment.
    """
    if not ws_url.startswith("wss"):
        return None
    ctx = _ssl.create_default_context()
    ctx.set_alpn_protocols(["http/1.1"])
    ctx._granbridge_alpn = ["http/1.1"]  # introspection hook for tests
    return ctx


async def check_ws(ws_url: str) -> tuple[bool | None, str]:
    try:
        import websockets
    except ImportError:
        return None, "wss connect: SKIPPED (install 'websockets' to enable this check)"
    try:
        async with websockets.connect(ws_url, open_timeout=5, ssl=_wss_ssl_context(ws_url)) as ws:
            await ws.send(json.dumps({
                "type": "join", "room": "__smoke__", "password": "smoke",
                "player": {"id": "smoke", "name": "smoke"},
            }))
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            ok = msg.get("type") == "joined"
            return ok, f"ws join: type={msg.get('type')} self={str(msg.get('self', '?'))[:8]}"
    except Exception as exc:
        return False, f"ws connect/join: {exc}"


async def check_stats(ws_url: str, http_base: str) -> tuple[bool | None, str]:
    """Submit a throwaway match over WS, then read it back via GET /stats/player/<id>."""
    try:
        import websockets
    except ImportError:
        return None, "stats: SKIPPED (install 'websockets' to enable this check)"
    import uuid as _uuid
    pid = "smoke-" + _uuid.uuid4().hex[:8]
    match = {
        "match_id": "smoke-" + _uuid.uuid4().hex[:8], "mode": "x01",
        "opponent_id": None, "winner_id": pid, "is_remote": False,
        "darts": 9, "total_scored": 180,
        "started_at": "2026-01-01T00:00:00.000Z", "ended_at": "2026-01-01T00:05:00.000Z",
        "throws": None,
    }
    try:
        async with websockets.connect(ws_url, open_timeout=5, ssl=_wss_ssl_context(ws_url)) as ws:
            await ws.send(json.dumps({"type": "stats_submit", "id": pid, "writeToken": "smoke",
                                      "player": {"id": pid, "name": pid}, "match": match}))
            ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        if ack.get("type") == "error" and ack.get("code") == "unsupported":
            return None, "stats: SKIPPED (broker has stats disabled)"
        if ack.get("type") != "stats_ack":
            return False, f"stats submit: unexpected reply {ack.get('type')}"
        def _fetch_player():
            with urllib.request.urlopen(http_base + "/stats/player/" + pid, timeout=5) as resp:
                return json.loads(resp.read())
        body = await asyncio.to_thread(_fetch_player)
        ok = body.get("games_played") == 1
        return ok, f"stats: submit+read round-trip games_played={body.get('games_played')}"
    except Exception as exc:
        return False, f"stats: {exc}"


async def run(ws_url: str, legacy_udp: bool = False) -> bool:
    base = _http_base(ws_url)
    host = urlparse(ws_url).hostname or ""
    results = [check_health(base), check_turn(base)]
    try:
        creds = _fetch_turn(base)
        endpoint = turns_endpoint(creds.get("uris"))
        if endpoint:
            results.append(check_turns_tcp_relay(endpoint[0] or host, endpoint[1],
                                                 creds["username"], creds["credential"]))
        else:
            results.append((False, "turns relay: /turn advertised no turns: URI"))
    except Exception as exc:
        results.append((False, f"turns relay: couldn't fetch creds: {exc}"))
    if legacy_udp:
        results.append(check_stun(host, 3478))
        try:
            creds = _fetch_turn(base)
            results.append(check_turn_relay(host, 3478, creds["username"], creds["credential"]))
        except Exception as exc:
            results.append((False, f"turn relay (udp): couldn't fetch creds: {exc}"))
    else:
        results.append((None, "udp 3478 checks: SKIPPED (443-only mode; pass --legacy-udp to test 3478)"))
    results.append(await check_ws(ws_url))
    results.append(await check_stats(ws_url, base))
    all_ok = True
    for ok, detail in results:
        label = "SKIP  " if ok is None else ("PASS  " if ok else "FAIL  ")
        if ok is False:
            all_ok = False
        print(label + detail)
    return all_ok


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    legacy_udp = "--legacy-udp" in argv
    positional = [a for a in argv if not a.startswith("--")]
    if not positional:
        print("usage: python smoke.py <ws://host:port | wss://domain> [--legacy-udp]")
        return 2
    try:
        ok = asyncio.run(run(positional[0], legacy_udp=legacy_udp))
    except ValueError as exc:
        print(f"error: {exc}")
        return 2
    print("\nRESULT: " + ("OK" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
