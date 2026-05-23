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
import sys
import urllib.request


def _http_base(ws_url: str) -> str:
    scheme = "https" if ws_url.startswith("wss") else "http"
    rest = ws_url[ws_url.index("://"):] if "://" in ws_url else "://" + ws_url
    return (scheme + rest).rstrip("/")


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
        return ok, f"/turn: username={'set' if data.get('username') else 'MISSING'} uris={data.get('uris')}"
    except Exception as exc:
        return False, f"/turn: {exc}"


async def check_ws(ws_url: str) -> tuple[bool, str]:
    try:
        import websockets
    except ImportError:
        return True, "wss connect: SKIPPED (install 'websockets' to enable this check)"
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
    results = [
        check_health(base),
        check_turn(base),
        await check_ws(ws_url),
    ]
    all_ok = True
    for ok, detail in results:
        print(("PASS  " if ok else "FAIL  ") + detail)
        all_ok = all_ok and ok
    return all_ok


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        print("usage: python smoke.py <ws://host:port | wss://domain>")
        return 2
    ok = asyncio.run(run(argv[0]))
    print("\nRESULT: " + ("OK" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
