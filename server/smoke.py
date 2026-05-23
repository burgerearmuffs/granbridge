"""server/smoke.py — validate a GRANBRIDGE broker deployment from the client side.

Usage:
    python smoke.py wss://play.example.com
    python smoke.py ws://127.0.0.1:8788

Checks (no WebRTC/browser needed):
  * GET /healthz           — broker up, returns status ok
  * GET /turn              — credential endpoint returns a well-formed payload
  * wss:// connect + join  — WebSocket reachable, room join works (skipped if the
                             'websockets' package isn't installed)

Note: actual TURN *relay* needs a real WebRTC peer (browser) — that stays a
manual check. This tool confirms the broker, TLS, and the /turn endpoint work.
"""
from __future__ import annotations

import asyncio
import json
import os
import socket
import struct
import sys
import urllib.request
from urllib.parse import urlparse


_STUN_MAGIC = 0x2112A442


def build_stun_binding_request() -> bytes:
    """A 20-byte STUN Binding Request (RFC 5389): type, length=0, magic, random txn id."""
    return struct.pack(">HHI", 0x0001, 0, _STUN_MAGIC) + os.urandom(12)


def parse_xor_mapped_address(data: bytes):
    """Return (ip, port) from a STUN response's XOR-MAPPED-ADDRESS (IPv4), or None."""
    if len(data) < 20:
        return None
    _mtype, mlen, magic = struct.unpack(">HHI", data[:8])
    if magic != _STUN_MAGIC:
        return None
    off, end = 20, min(20 + mlen, len(data))
    while off + 4 <= end:
        atype, alen = struct.unpack(">HH", data[off:off + 4])
        val = data[off + 4:off + 4 + alen]
        if atype == 0x0020 and len(val) >= 8 and val[1] == 0x01:  # XOR-MAPPED-ADDRESS, IPv4
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


def check_turn(http_base: str) -> tuple[bool, str]:
    try:
        with urllib.request.urlopen(http_base + "/turn", timeout=5) as resp:
            data = json.loads(resp.read())
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


async def check_ws(ws_url: str) -> tuple[bool | None, str]:
    try:
        import websockets
    except ImportError:
        return None, "wss connect: SKIPPED (install 'websockets' to enable this check)"
    try:
        async with websockets.connect(ws_url, open_timeout=5) as ws:
            await ws.send(json.dumps({
                "type": "join", "room": "__smoke__", "password": "smoke",
                "player": {"id": "smoke", "name": "smoke"},
            }))
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            ok = msg.get("type") == "joined"
            return ok, f"ws join: type={msg.get('type')} self={str(msg.get('self', '?'))[:8]}"
    except Exception as exc:
        return False, f"ws connect/join: {exc}"


async def run(ws_url: str) -> bool:
    base = _http_base(ws_url)
    host = urlparse(ws_url).hostname or ""
    results = [
        check_health(base),
        check_turn(base),
        check_stun(host, 3478),
        await check_ws(ws_url),
    ]
    all_ok = True
    for ok, detail in results:
        if ok is None:
            label = "SKIP  "
        elif ok:
            label = "PASS  "
        else:
            label = "FAIL  "
            all_ok = False
        print(label + detail)
    return all_ok


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        print("usage: python smoke.py <ws://host:port | wss://domain>")
        return 2
    try:
        ok = asyncio.run(run(argv[0]))
    except ValueError as exc:
        print(f"error: {exc}")
        return 2
    print("\nRESULT: " + ("OK" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
