# Server Deployment Smoke Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A zero-/low-dependency CLI (`server/smoke.py`) that validates a live GRANBRIDGE broker deployment from the client side — `/healthz`, `/turn` credential structure, and a `wss://` connect + room join — so the operator can confirm the broker, TLS, and credential endpoint work without a browser. Plus an integration test that runs it against a local broker (closing the "HTTP endpoints never exercised over a real socket" coverage gap).

**Architecture:** Pure check functions (`check_health`/`check_turn` over stdlib `urllib`; `check_ws` over `websockets` if installed, else SKIP) + a `run()` that prints a PASS/FAIL report and returns an exit code. Ships inside `server/` so it's included in the server release zip and runnable on TOWER.

**Tech Stack:** Python 3.12 stdlib + optional `websockets`. **Branch:** `server-smoke-tool`. **Self-approved** under the autonomous mandate (user is testing the live server in parallel).

**Scope note:** This validates the broker + endpoints + WS. Actual TURN *relay* still needs a real WebRTC peer (browser) — that remains manual-verify; the tool says so.

**Verification:** Python tests run locally. Commit messages end with `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

---

### Task 1: `smoke.py` tool + integration test

**Files:** Create `server/smoke.py`; Test `server/tests/test_smoke.py`.

- [ ] **Step 1: Write the failing test** — `server/tests/test_smoke.py`:

```python
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
```

- [ ] **Step 2: Run, expect fail** — `python -m pytest server/tests/test_smoke.py -v` → `ModuleNotFoundError: No module named 'smoke'`.

- [ ] **Step 3: Implement** — `server/smoke.py`:

```python
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
```

- [ ] **Step 4: Run, expect pass** — `python -m pytest server/tests/test_smoke.py -v` → all pass. Also smoke the tool manually against a backgrounded local broker:
  start `TURN_SECRET=dev DOMAIN=localhost BROKER_PORT=8799 python -m granbridge_broker` as a BACKGROUND process (from `server/` or with `PYTHONPATH=server`), then `python server/smoke.py ws://127.0.0.1:8799` → all PASS, `RESULT: OK`; stop the background process. (If background management is awkward, rely on the integration test — don't block.)

- [ ] **Step 5: Run the whole server suite** — `python -m pytest server/tests -q` → all green (no regression).

- [ ] **Step 6: Commit**

```bash
git add server/smoke.py server/tests/test_smoke.py
git commit -m "feat(server): deployment smoke-test CLI + integration test

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: README "Validate a deployment" + BUILD-LOG + finish

**Files:** Modify `server/README.md`, `docs/BUILD-LOG.md`.

- [ ] **Step 1: README** — add a short "Validate a deployment" subsection to `server/README.md` (near the existing "Verify" section): after `docker compose up -d --build`, run `python smoke.py wss://$DOMAIN` (note `pip install websockets` enables the WS check) to confirm `/healthz`, `/turn`, and a `wss://` join in one command; note TURN relay itself remains a browser manual-verify.

- [ ] **Step 2: Run suites** — `python -m pytest server/tests -q` (green) and `npm --prefix ui test` (unchanged). If any fail, STOP/BLOCKED.

- [ ] **Step 3: BUILD-LOG** — append a concise "Server deployment smoke tool" entry to `docs/BUILD-LOG.md`: what `server/smoke.py` checks (/healthz, /turn structure, wss:// join; TURN relay still manual), the integration test closing the over-the-wire HTTP gap, plan path, and the new server-test count.

- [ ] **Step 4: Commit** — `git add server/README.md docs/BUILD-LOG.md && git commit -m "docs: document the deployment smoke tool + BUILD-LOG entry

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"`

- [ ] **Step 5: Finish** — controller runs `superpowers:finishing-a-development-branch` (merge to local main; push/release deferred to the user).

---

## Self-Review

**Spec coverage:** smoke tool (/healthz, /turn, wss:// join) → Task 1; integration test closing the over-the-wire gap → Task 1; docs → Task 2. ✔
**Placeholder scan:** BUILD-LOG count in Task 2 filled in after the run; no other gaps. The manual background-smoke in Task 1 Step 4 is optional (the integration test is the gating verification). ✔
**Type/name consistency:** `_http_base`, `check_health`, `check_turn`, `check_ws`, `run`, `main` used identically in `smoke.py` and `test_smoke.py`. `check_*` return `(bool, str)` everywhere; `check_ws` is async (awaited), the two HTTP checks are sync (run via `asyncio.to_thread` in the async test to avoid blocking the broker's event loop). `import smoke` resolves via `server/conftest.py` putting `server/` on `sys.path`. ✔
