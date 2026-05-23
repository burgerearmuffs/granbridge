# Broker + coturn TOWER Deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productionize the multiplayer backend (`server/`) for a real public deployment on TOWER — bundled Caddy TLS, a TURN credential endpoint, coturn correctness/hardening, broker hardening, pinned/contained Docker — and wire the client to use TURN end-to-end with a STUN-only fallback.

**Architecture:** One `docker compose` stack — a one-shot `init` (generates the shared TURN secret), `caddy` (auto Let's Encrypt → `wss://` broker + reverse-proxied HTTP), `broker` (WS rooms + a single-port HTTP `/turn` + `/healthz`), and `coturn` (`turn://` + `turns://` reusing Caddy's cert, auto-reloaded). The broker stays stateless and in-memory; the client fetches short-lived TURN creds from `/turn` at join.

**Tech Stack:** Python 3.12 + `websockets` 15 (single-port WS+HTTP via `process_request`), coturn (`--use-auth-secret` HMAC-SHA1 REST creds), Caddy 2, Docker Compose; client is React/TS (Vitest).

**Branch:** `broker-tower-deploy` (already checked out). **Spec:** `docs/superpowers/specs/2026-05-22-mp-broker-tower-deploy-design.md`.

**Note on verification:** Python + client tests run locally. Docker/Caddy/coturn (Tasks 6–11) are authored + inspected here; real TLS/TURN traversal is **manual-verify on TOWER** (documented in Task 11), per the spec.

---

### Task 1: TURN credential minting (`turn.py`)

**Files:**
- Create: `server/granbridge_broker/turn.py`
- Test: `server/tests/test_turn.py`

- [ ] **Step 1: Write the failing test**

```python
# server/tests/test_turn.py
import base64, hashlib, hmac
from granbridge_broker.turn import make_turn_credentials


def test_credentials_match_coturn_rest_contract():
    creds = make_turn_credentials("s3cr3t", "play.example.com", ttl=100, now=1000.0)
    assert creds["username"] == "1100"            # str(int(now) + ttl)
    assert creds["ttl"] == 100
    expected = base64.b64encode(
        hmac.new(b"s3cr3t", b"1100", hashlib.sha1).digest()
    ).decode()
    assert creds["credential"] == expected
    assert creds["uris"] == [
        "turn:play.example.com:3478?transport=udp",
        "turn:play.example.com:3478?transport=tcp",
        "turns:play.example.com:5349?transport=tcp",
    ]


def test_username_advances_with_now():
    a = make_turn_credentials("k", "d", 60, 1000.0)["username"]
    b = make_turn_credentials("k", "d", 60, 2000.0)["username"]
    assert int(b) - int(a) == 1000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest server/tests/test_turn.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'granbridge_broker.turn'`

- [ ] **Step 3: Write minimal implementation**

```python
# server/granbridge_broker/turn.py
"""Pure TURN REST-API credential minting for coturn --use-auth-secret.

coturn's time-limited credential contract:
  username   = "<unix-expiry-timestamp>"
  credential = base64( HMAC-SHA1( static_auth_secret, username ) )
The static secret never leaves the server; clients receive only short-lived creds.
"""
from __future__ import annotations

import base64
import hashlib
import hmac


def make_turn_credentials(secret: str, domain: str, ttl: int, now: float) -> dict:
    username = str(int(now) + ttl)
    digest = hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()
    credential = base64.b64encode(digest).decode()
    uris = [
        f"turn:{domain}:3478?transport=udp",
        f"turn:{domain}:3478?transport=tcp",
        f"turns:{domain}:5349?transport=tcp",
    ]
    return {"username": username, "credential": credential, "ttl": ttl, "uris": uris}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest server/tests/test_turn.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add server/granbridge_broker/turn.py server/tests/test_turn.py
git commit -m "feat(broker): pure TURN REST credential minting (turn.py)"
```

---

### Task 2: Config + secret resolution (`config.py`)

**Files:**
- Create: `server/granbridge_broker/config.py`
- Test: `server/tests/test_config.py`

- [ ] **Step 1: Write the failing test**

```python
# server/tests/test_config.py
from granbridge_broker.config import resolve_secret, from_env


def test_resolve_secret_prefers_env(tmp_path):
    f = tmp_path / "turn_secret"
    f.write_text("from-file")
    assert resolve_secret("from-env", str(f)) == "from-env"


def test_resolve_secret_reads_file_when_env_absent(tmp_path):
    f = tmp_path / "turn_secret"
    f.write_text("  file-secret\n")
    assert resolve_secret(None, str(f)) == "file-secret"


def test_from_env_parses_and_defaults():
    env = {"TURN_SECRET": "x", "DOMAIN": "play.example.com", "ALLOWED_ORIGINS": "a, b"}
    cfg = from_env(env)
    assert cfg.turn_secret == "x"
    assert cfg.turn_domain == "play.example.com"
    assert cfg.allowed_origins == ("a", "b")
    assert cfg.port == 8788
    assert cfg.max_rooms == 200
    assert cfg.room_size_cap == 4


def test_from_env_origins_empty_means_permissive():
    cfg = from_env({"TURN_SECRET": "x", "DOMAIN": "d"})
    assert cfg.allowed_origins is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest server/tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'granbridge_broker.config'`

- [ ] **Step 3: Write minimal implementation**

```python
# server/granbridge_broker/config.py
"""Environment parsing + TURN secret resolution for the broker.

Only DOMAIN is required at deploy time. TURN_SECRET is resolved from the env if
set, else read from SECRET_PATH (written once by the compose `init` one-shot).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

DEFAULT_PORT = 8788
DEFAULT_SECRET_PATH = "/secrets/turn_secret"


@dataclass(frozen=True)
class BrokerConfig:
    host: str
    port: int
    room_size_cap: int
    max_rooms: int
    max_size: int
    allowed_origins: Optional[tuple[str, ...]]
    turn_secret: str
    turn_domain: str
    turn_ttl: int


def resolve_secret(env_secret: Optional[str], secret_path: str) -> str:
    if env_secret:
        return env_secret
    with open(secret_path, "r", encoding="utf-8") as fh:
        return fh.read().strip()


def from_env(env=None) -> BrokerConfig:
    env = os.environ if env is None else env
    origins_raw = (env.get("ALLOWED_ORIGINS") or "").strip()
    allowed = tuple(o.strip() for o in origins_raw.split(",") if o.strip()) or None
    secret = resolve_secret(
        env.get("TURN_SECRET"), env.get("SECRET_PATH", DEFAULT_SECRET_PATH)
    )
    domain = env.get("DOMAIN") or env.get("TURN_REALM") or "granbridge.local"
    return BrokerConfig(
        host=env.get("BROKER_HOST", "0.0.0.0"),
        port=int(env.get("BROKER_PORT", str(DEFAULT_PORT))),
        room_size_cap=int(env.get("ROOM_SIZE_CAP", "4")),
        max_rooms=int(env.get("MAX_ROOMS", "200")),
        max_size=int(env.get("MAX_MSG_BYTES", "65536")),
        allowed_origins=allowed,
        turn_secret=secret,
        turn_domain=domain,
        turn_ttl=int(env.get("TURN_TTL", "86400")),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest server/tests/test_config.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add server/granbridge_broker/config.py server/tests/test_config.py
git commit -m "feat(broker): env config + TURN secret resolution (config.py)"
```

---

### Task 3: HTTP responses + `/healthz` + `/turn` on the broker port (`http.py` + broker routing)

**Files:**
- Create: `server/granbridge_broker/http.py`
- Modify: `server/granbridge_broker/broker.py` (ctor adds keyword args; new `_http_route`, `_process_request`; pass `process_request`/`max_size` to `serve`)
- Test: `server/tests/test_http.py`

- [ ] **Step 1: Write the failing test**

```python
# server/tests/test_http.py
import json
from granbridge_broker.http import json_response, origin_allowed
from granbridge_broker.broker import BrokerServer


def test_json_response_shape():
    resp = json_response(200, {"ok": True})
    assert resp.status_code == 200
    assert resp.headers["Content-Type"] == "application/json"
    assert resp.headers["Access-Control-Allow-Origin"] == "*"
    assert json.loads(resp.body)["ok"] is True


def test_origin_allowed_permissive_when_unset():
    assert origin_allowed(None, None) is True
    assert origin_allowed("https://evil.test", None) is True


def test_origin_allowed_enforced_when_set():
    allowed = ("https://app.example.com",)
    assert origin_allowed("https://app.example.com", allowed) is True
    assert origin_allowed("https://evil.test", allowed) is False
    assert origin_allowed(None, allowed) is False


def test_broker_http_route_healthz_and_turn():
    s = BrokerServer("127.0.0.1", 0, turn_secret="sek", turn_domain="play.example.com")
    health = s._http_route("/healthz")
    assert health.status_code == 200
    body = json.loads(health.body)
    assert body["status"] == "ok" and body["rooms"] == 0 and body["peers"] == 0

    turn = s._http_route("/turn")
    assert turn.status_code == 200
    tbody = json.loads(turn.body)
    assert tbody["username"] and tbody["credential"]
    assert tbody["uris"][0] == "turn:play.example.com:3478?transport=udp"

    assert s._http_route("/anything-else") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest server/tests/test_http.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'granbridge_broker.http'`

- [ ] **Step 3a: Create `http.py`**

```python
# server/granbridge_broker/http.py
"""Plain-HTTP helpers served on the same port as the WebSocket broker.

websockets lets one server answer HTTP via process_request: return a Response to
short-circuit (HTTP), or None to let the connection upgrade to WebSocket.
"""
from __future__ import annotations

import json
from typing import Optional

from websockets.datastructures import Headers
from websockets.http11 import Response


def json_response(status_code: int, payload: dict, reason: str = "OK") -> Response:
    body = (json.dumps(payload) + "\n").encode()
    headers = Headers()
    headers["Content-Type"] = "application/json"
    headers["Content-Length"] = str(len(body))
    headers["Access-Control-Allow-Origin"] = "*"  # public, non-credentialed endpoints
    return Response(status_code, reason, headers, body)


def origin_allowed(origin: Optional[str], allowed: Optional[tuple[str, ...]]) -> bool:
    """Permissive when no allowlist is configured (native apps send a null origin)."""
    if not allowed:
        return True
    return origin in allowed
```

- [ ] **Step 3b: Modify `broker.py` — imports + constructor**

Add to the imports block near the top (after the existing `from websockets...` imports):

```python
import logging
import time

from granbridge_broker.http import json_response, origin_allowed
from granbridge_broker.turn import make_turn_credentials
```

Replace the existing constructor (`def __init__(self, host=..., port=..., room_size_cap=...) -> None:` and its body) with:

```python
    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 8788,
        room_size_cap: int = DEFAULT_ROOM_SIZE_CAP,
        *,
        max_rooms: int = 200,
        max_size: int = 65536,
        allowed_origins: Optional[tuple[str, ...]] = None,
        turn_secret: str = "",
        turn_domain: str = "granbridge.local",
        turn_ttl: int = 86400,
    ) -> None:
        self._host = host
        self._port = port
        self._room_size_cap = room_size_cap
        self._max_rooms = max_rooms
        self._max_size = max_size
        self._allowed_origins = allowed_origins
        self._turn_secret = turn_secret
        self._turn_domain = turn_domain
        self._turn_ttl = turn_ttl
        self._log = logging.getLogger("granbridge.broker")
        # room_name -> _Room
        self._rooms: dict[str, _Room] = {}
        # peer_id -> _Member (with .ws for direct send)
        self._peers: dict[str, _Member] = {}
        # peer_id -> room_name (for cleanup)
        self._peer_room: dict[str, str] = {}
        self._server: Optional[Server] = None
```

- [ ] **Step 3c: Modify `broker.py` — `start()` + new HTTP methods**

Replace `start()`:

```python
    async def start(self) -> None:
        self._server = await serve(
            self._handle,
            self._host,
            self._port,
            process_request=self._process_request,
            max_size=self._max_size,
        )
```

Add these two methods (e.g. just after `stop()`):

```python
    # ------------------------------------------------------------------
    # HTTP (same port as the WebSocket) — health + TURN credentials
    # ------------------------------------------------------------------

    def _http_route(self, path: str):
        if path == "/healthz":
            return json_response(
                200,
                {"status": "ok", "rooms": len(self._rooms), "peers": len(self._peers)},
            )
        if path == "/turn":
            return json_response(
                200,
                make_turn_credentials(
                    self._turn_secret, self._turn_domain, self._turn_ttl, time.time()
                ),
            )
        return None

    def _process_request(self, connection, request):
        resp = self._http_route(request.path)
        if resp is not None:
            return resp
        # WebSocket upgrade path — optional Origin allowlist (default permissive)
        if self._allowed_origins is not None:
            origin = request.headers.get("Origin")
            if not origin_allowed(origin, self._allowed_origins):
                self._log.warning("rejected WS upgrade: forbidden origin %r", origin)
                return json_response(403, {"error": "forbidden_origin"}, reason="Forbidden")
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest server/tests/test_http.py server/tests/test_broker.py -v`
Expected: PASS (4 new + 4 existing broker tests still green)

- [ ] **Step 5: Commit**

```bash
git add server/granbridge_broker/http.py server/granbridge_broker/broker.py server/tests/test_http.py
git commit -m "feat(broker): single-port HTTP /healthz + /turn (+ origin helper)"
```

---

### Task 4: Broker hardening — room-count cap + structured logging

**Files:**
- Modify: `server/granbridge_broker/broker.py` (room-count cap in `join`; a few log lines)
- Test: `server/tests/test_broker_caps.py`

`max_size` (frame cap) and the Origin allowlist were wired in Task 3. This task adds the room-count cap and logging.

- [ ] **Step 1: Write the failing test**

```python
# server/tests/test_broker_caps.py
import asyncio, json, pytest, websockets
from granbridge_broker.broker import BrokerServer

async def _recv(ws): return json.loads(await asyncio.wait_for(ws.recv(), timeout=1))

async def _join(ws, room, pw, pid):
    await ws.send(json.dumps({"type": "join", "room": room, "password": pw,
                              "player": {"id": pid, "name": pid}}))

@pytest.fixture
async def server():
    s = BrokerServer("127.0.0.1", 8796, max_rooms=2)
    await s.start()
    yield s
    await s.stop()

async def test_new_room_beyond_cap_is_rejected(server):
    a = await websockets.connect("ws://127.0.0.1:8796")
    b = await websockets.connect("ws://127.0.0.1:8796")
    c = await websockets.connect("ws://127.0.0.1:8796")
    try:
        await _join(a, "r1", "p", "A"); await _recv(a)   # rooms = 1
        await _join(b, "r2", "p", "B"); await _recv(b)   # rooms = 2 (at cap)
        await _join(c, "r3", "p", "C")                   # new room beyond cap
        err = await _recv(c)
        assert err["type"] == "error" and err["code"] == "server_full"
    finally:
        for ws in (a, b, c): await ws.close()

async def test_join_existing_room_still_ok_at_cap(server):
    a = await websockets.connect("ws://127.0.0.1:8796")
    b = await websockets.connect("ws://127.0.0.1:8796")
    c = await websockets.connect("ws://127.0.0.1:8796")
    try:
        await _join(a, "r1", "p", "A"); await _recv(a)   # rooms = 1
        await _join(b, "r2", "p", "B"); await _recv(b)   # rooms = 2 (at cap)
        await _join(c, "r1", "p", "C")                   # EXISTING room — allowed
        joined = await _recv(c)
        assert joined["type"] == "joined"
    finally:
        for ws in (a, b, c): await ws.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest server/tests/test_broker_caps.py -v`
Expected: FAIL — `server_full` never sent; first test times out / assertion error.

- [ ] **Step 3: Implement the room-count cap + logging in `broker.py`**

In `_handle`, inside the `if mtype == "join":` block, locate:

```python
                    pw_hash = _sha256(str(password))

                    if room_name in self._rooms:
```

Insert the cap check immediately before `if room_name in self._rooms:` (after the `pw_hash = ...` line):

```python
                    pw_hash = _sha256(str(password))

                    if room_name not in self._rooms and len(self._rooms) >= self._max_rooms:
                        await _error(ws, "server_full", "too many rooms")
                        continue

                    if room_name in self._rooms:
```

Then add a log line where a room is created — change:

```python
                    else:
                        # First joiner creates the room and sets password
                        room = _Room(password_hash=pw_hash)
                        self._rooms[room_name] = room
```
to:
```python
                    else:
                        # First joiner creates the room and sets password
                        room = _Room(password_hash=pw_hash)
                        self._rooms[room_name] = room
                        self._log.info("room created name=%s (rooms=%d)", room_name, len(self._rooms))
```

And in `_remove_peer`, change the reap branch:

```python
        if not room.members:
            # Reap empty room
            del self._rooms[room_name]
```
to:
```python
        if not room.members:
            # Reap empty room
            del self._rooms[room_name]
            self._log.info("room reaped name=%s (rooms=%d)", room_name, len(self._rooms))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest server/tests -v`
Expected: PASS (all server tests green: turn, config, http, broker, broker_caps)

- [ ] **Step 5: Commit**

```bash
git add server/granbridge_broker/broker.py server/tests/test_broker_caps.py
git commit -m "feat(broker): room-count cap (server_full) + room lifecycle logging"
```

---

### Task 5: Entry point — config wiring + graceful shutdown (`__main__.py`)

**Files:**
- Modify: `server/granbridge_broker/__main__.py`

No new unit test (signal handling + `serve` lifetime are integration concerns verified by running the container; the constituent pieces are already tested). Verify by a local smoke run.

- [ ] **Step 1: Replace `__main__.py` entirely**

```python
"""Entry point: python -m granbridge_broker

Builds the broker from environment config (see config.from_env), logs to stdout,
and shuts down cleanly on SIGTERM/SIGINT so `docker stop` is fast.
"""
import asyncio
import logging
import signal

from granbridge_broker.broker import BrokerServer
from granbridge_broker.config import from_env


async def _main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    log = logging.getLogger("granbridge.broker")
    cfg = from_env()
    server = BrokerServer(
        cfg.host,
        cfg.port,
        cfg.room_size_cap,
        max_rooms=cfg.max_rooms,
        max_size=cfg.max_size,
        allowed_origins=cfg.allowed_origins,
        turn_secret=cfg.turn_secret,
        turn_domain=cfg.turn_domain,
        turn_ttl=cfg.turn_ttl,
    )
    await server.start()
    log.info(
        "broker listening host=%s port=%s domain=%s max_rooms=%s origins=%s",
        cfg.host, cfg.port, cfg.turn_domain, cfg.max_rooms, cfg.allowed_origins,
    )

    loop = asyncio.get_running_loop()
    stop = loop.create_future()

    def _request_stop() -> None:
        if not stop.done():
            stop.set_result(None)

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except NotImplementedError:
            # Windows dev: rely on KeyboardInterrupt below
            pass

    try:
        await stop
    finally:
        log.info("shutting down")
        await server.stop()


if __name__ == "__main__":
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        pass
```

- [ ] **Step 2: Smoke-test locally (provide the secret via env so no /secrets file is needed)**

Run (PowerShell):
```powershell
$env:TURN_SECRET="dev"; $env:DOMAIN="localhost"; $env:BROKER_PORT="8799"
python -m granbridge_broker
```
Expected: logs `broker listening host=0.0.0.0 port=8799 domain=localhost ...`. In another shell:
`python -c "import urllib.request,json; print(json.load(urllib.request.urlopen('http://127.0.0.1:8799/turn')))"`
Expected: a dict with `username`, `credential`, `uris`. Then Ctrl-C — process exits promptly. Unset the env vars afterward.

- [ ] **Step 3: Run the full server suite (regression)**

Run: `python -m pytest server/tests -v`
Expected: PASS (all green)

- [ ] **Step 4: Commit**

```bash
git add server/granbridge_broker/__main__.py
git commit -m "feat(broker): config-driven startup + graceful SIGTERM shutdown"
```

---

### Task 6: Pin deps + harden the broker image

**Files:**
- Modify: `server/requirements.txt`
- Modify: `server/Dockerfile`

- [ ] **Step 1: Pin `requirements.txt`**

```
websockets==15.0.1
```

- [ ] **Step 2: Rewrite `server/Dockerfile`**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install deps first for layer caching
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY granbridge_broker/ ./granbridge_broker/

# Non-root runtime user; /secrets is a read mount (written by the init one-shot)
RUN adduser --disabled-password --gecos "" --no-create-home app \
    && mkdir -p /secrets && chown app:app /app
USER app

EXPOSE 8788

# Health: the broker answers /healthz over plain HTTP on the same port
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8788/healthz', timeout=3).status==200 else 1)"]

CMD ["python", "-m", "granbridge_broker"]
```

- [ ] **Step 3: Validate (best-effort; Docker may be absent locally)**

Run: `docker build -t granbridge-broker:test server/ 2>&1 | tail -5 || echo "Docker not available — verify on TOWER"`
Expected: a successful build, or the fallback message (image build is verified on TOWER).

- [ ] **Step 4: Commit**

```bash
git add server/requirements.txt server/Dockerfile
git commit -m "build(broker): pin websockets==15.0.1; non-root image + HEALTHCHECK"
```

---

### Task 7: Compose stack rewrite (init + caddy + broker + coturn)

**Files:**
- Modify: `server/docker-compose.yml`

- [ ] **Step 1: Replace `server/docker-compose.yml` entirely**

```yaml
# GRANBRIDGE multiplayer stack for TOWER.
# One command:  docker compose up -d --build
# Only DOMAIN is required (set it in .env). TURN_SECRET auto-generates if unset.

services:

  # One-shot: generate the shared TURN secret once (root → deterministic perms).
  init:
    image: alpine:3.20
    command: >
      sh -c '[ -n "$$TURN_SECRET" ] && exit 0;
             [ -s /secrets/turn_secret ] && exit 0;
             head -c 32 /dev/urandom | base64 | tr -d "\n" > /secrets/turn_secret;
             chmod 644 /secrets/turn_secret;
             echo "generated /secrets/turn_secret"'
    environment:
      TURN_SECRET: "${TURN_SECRET:-}"
    volumes:
      - secrets:/secrets

  caddy:
    image: caddy:2.8
    restart: unless-stopped
    depends_on:
      init:
        condition: service_completed_successfully
    ports:
      - "80:80"
      - "443:443"
    environment:
      DOMAIN: "${DOMAIN:?set DOMAIN in .env}"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [backend]

  broker:
    build: .
    restart: unless-stopped
    depends_on:
      init:
        condition: service_completed_successfully
    environment:
      BROKER_HOST: "0.0.0.0"
      BROKER_PORT: "8788"
      DOMAIN: "${DOMAIN:?set DOMAIN in .env}"
      TURN_SECRET: "${TURN_SECRET:-}"
      TURN_TTL: "${TURN_TTL:-86400}"
      ALLOWED_ORIGINS: "${ALLOWED_ORIGINS:-}"
      SECRET_PATH: "/secrets/turn_secret"
    volumes:
      - secrets:/secrets:ro
    networks: [backend]
    # No host port: only Caddy reaches the broker (smaller public surface).

  coturn:
    image: coturn/coturn:4.6.2
    restart: unless-stopped
    network_mode: host          # needs the relay port range + 3478/5349 on the host
    depends_on:
      init:
        condition: service_completed_successfully
    environment:
      DOMAIN: "${DOMAIN:?set DOMAIN in .env}"
      TURN_REALM: "${TURN_REALM:-${DOMAIN}}"
      TURN_SECRET: "${TURN_SECRET:-}"
      TURN_EXTERNAL_IP: "${TURN_EXTERNAL_IP:-}"
    volumes:
      - caddy_data:/caddy-data:ro      # read Caddy's Let's Encrypt cert
      - secrets:/secrets:ro
      - ./coturn/entrypoint.sh:/entrypoint.sh:ro
    entrypoint: ["/bin/sh", "/entrypoint.sh"]

networks:
  backend:

volumes:
  caddy_data:
  caddy_config:
  secrets:
```

- [ ] **Step 2: Validate compose syntax (best-effort)**

Run: `docker compose -f server/docker-compose.yml config >NUL 2>&1 && echo OK || echo "Docker not available — verify on TOWER"`
Expected: `OK`, or the fallback message.

- [ ] **Step 3: Commit**

```bash
git add server/docker-compose.yml
git commit -m "build(server): contained compose stack (init+caddy+broker+coturn), no broker host port"
```

---

### Task 8: Caddyfile (auto-TLS reverse proxy)

**Files:**
- Create: `server/Caddyfile`

- [ ] **Step 1: Create `server/Caddyfile`**

```
# Caddy obtains + auto-renews a Let's Encrypt cert for $DOMAIN and reverse-proxies
# everything to the broker: WebSocket upgrades (wss:// play) and the plain-HTTP
# /turn and /healthz endpoints all share one origin.
#
# Optional: to receive renewal/expiry notices, add a global options block above
# the site, e.g.:   {  email you@example.com  }

{$DOMAIN} {
	reverse_proxy broker:8788
}
```

- [ ] **Step 2: Commit**

```bash
git add server/Caddyfile
git commit -m "build(server): Caddyfile — auto Let's Encrypt + reverse_proxy to broker"
```

---

### Task 9: coturn entrypoint — cert reuse + zero-touch reload

**Files:**
- Create: `server/coturn/entrypoint.sh`

- [ ] **Step 1: Create `server/coturn/entrypoint.sh`**

```sh
#!/bin/sh
# coturn entrypoint: reuse Caddy's Let's Encrypt cert for turns://, fall back to
# turn://-only until the cert exists, and reload automatically on renewal.
set -eu

SECRET_FILE=/secrets/turn_secret
CERT_DIR=/etc/coturn/certs
CADDY_CERTS=/caddy-data/caddy/certificates

# Resolve the shared TURN secret (env override wins; else the init-generated file).
SECRET="${TURN_SECRET:-}"
if [ -z "$SECRET" ]; then
  i=0; while [ ! -s "$SECRET_FILE" ] && [ "$i" -lt 30 ]; do sleep 1; i=$((i+1)); done
  SECRET="$(cat "$SECRET_FILE" 2>/dev/null || echo '')"
fi
if [ -z "$SECRET" ]; then echo "FATAL: no TURN secret available" >&2; exit 1; fi

REALM="${TURN_REALM:-$DOMAIN}"
mkdir -p "$CERT_DIR"

# Locate Caddy's cert (the ACME-CA subdir name varies); copy to a stable path.
copy_cert() {
  src_crt="$(find "$CADDY_CERTS" -name "${DOMAIN}.crt" 2>/dev/null | head -n1 || true)"
  src_key="$(find "$CADDY_CERTS" -name "${DOMAIN}.key" 2>/dev/null | head -n1 || true)"
  if [ -n "$src_crt" ] && [ -n "$src_key" ]; then
    cp "$src_crt" "$CERT_DIR/turn.crt"; cp "$src_key" "$CERT_DIR/turn.key"
    return 0
  fi
  return 1
}

# Wait up to ~60s for Caddy to issue the cert on first boot.
i=0; while [ "$i" -lt 60 ] && ! copy_cert; do sleep 1; i=$((i+1)); done

COMMON="-n --log-file=stdout --no-cli --fingerprint \
  --lt-cred-mech --use-auth-secret --static-auth-secret=$SECRET --realm=$REALM \
  --listening-port=3478 --min-port=49152 --max-port=65535 \
  --no-loopback-peers --no-multicast-peers \
  --denied-peer-ip=10.0.0.0-10.255.255.255 \
  --denied-peer-ip=172.16.0.0-172.31.255.255 \
  --denied-peer-ip=192.168.0.0-192.168.255.255 \
  --denied-peer-ip=169.254.0.0-169.254.255.255 \
  --denied-peer-ip=127.0.0.0-127.255.255.255"

[ -n "${TURN_EXTERNAL_IP:-}" ] && COMMON="$COMMON --external-ip=$TURN_EXTERNAL_IP"

if [ -f "$CERT_DIR/turn.crt" ]; then
  TLS="--tls-listening-port=5349 --cert=$CERT_DIR/turn.crt --pkey=$CERT_DIR/turn.key"
  echo "coturn: turns:// enabled (cert found)"
else
  TLS=""
  echo "WARNING: cert not found; starting turn://-only (will restart when it appears)"
fi

# Background watcher: on renewal reload in place (SIGHUP); if TLS was off and the
# cert later appears, exit so Docker restarts us with turns:// enabled.
HAD_TLS=$([ -n "$TLS" ] && echo 1 || echo 0)
( while true; do
    sleep 3600
    before="$( [ -f "$CERT_DIR/turn.crt" ] && md5sum "$CERT_DIR/turn.crt" | cut -d' ' -f1 || echo none )"
    if copy_cert; then
      after="$(md5sum "$CERT_DIR/turn.crt" | cut -d' ' -f1)"
      if [ "$HAD_TLS" = "1" ] && [ "$before" != "$after" ]; then
        echo "coturn: cert changed — reloading (SIGHUP)"; pkill -HUP turnserver || true
      elif [ "$HAD_TLS" = "0" ]; then
        echo "coturn: cert now present — restarting to enable turns://"; pkill turnserver || true
      fi
    fi
  done ) &

# shellcheck disable=SC2086
exec turnserver $COMMON $TLS
```

- [ ] **Step 2: Mark executable + normalize line endings (LF, not CRLF — it runs in Linux)**

Run (PowerShell):
```powershell
git update-index --chmod=+x server/coturn/entrypoint.sh 2>$null
git add --renormalize server/coturn/entrypoint.sh
```
Also ensure the repo keeps LF for this file. Add to `server/.gitattributes` (create it):
```
*.sh text eol=lf
```

- [ ] **Step 3: Commit**

```bash
git add server/coturn/entrypoint.sh server/.gitattributes
git commit -m "build(coturn): cert reuse from Caddy + zero-touch reload + SSRF hardening"
```

---

### Task 10: `.env.example`

**Files:**
- Create: `server/.env.example`

- [ ] **Step 1: Create `server/.env.example`**

```bash
# ── GRANBRIDGE broker — only DOMAIN is required ──────────────────────────────
# Point this hostname's A record at TOWER's public IP first.
DOMAIN=play.example.com

# Optional. Leave TURN_SECRET unset to auto-generate one on first boot.
# TURN_SECRET=

# Set ONLY if TOWER is behind a router/NAT (coturn --external-ip):
#   format: PUBLIC_IP  or  PUBLIC_IP/PRIVATE_IP
# TURN_EXTERNAL_IP=

# Optional tuning:
# TURN_REALM=play.example.com      # defaults to DOMAIN
# TURN_TTL=86400                   # TURN credential lifetime (seconds)
# ALLOWED_ORIGINS=                 # comma-separated WS origin allowlist (default: allow all)
```

- [ ] **Step 2: Confirm `.dockerignore` already excludes `.env` (it does) and commit**

```bash
git add server/.env.example
git commit -m "docs(server): .env.example (DOMAIN-only minimal config)"
```

---

### Task 11: Rewrite `server/README.md` runbook

**Files:**
- Modify: `server/README.md`

- [ ] **Step 1: Replace `server/README.md` with the TOWER runbook**

````markdown
# granbridge-broker — Multiplayer Backend (TOWER)

A contained `docker compose` stack for GRANBRIDGE internet multiplayer:

- **caddy** — automatic Let's Encrypt TLS; reverse-proxies `wss://` + `/turn` + `/healthz` to the broker.
- **broker** — stateless WebSocket rooms (password + presence + WebRTC signaling) and a single-port HTTP
  `/turn` (short-lived TURN credentials) + `/healthz`.
- **coturn** — `turn://` (3478) and `turns://` (5349, reusing Caddy's cert) for NAT/firewall traversal.
- **init** — one-shot; generates the shared TURN secret on first boot.

The broker is stateless (in-memory). Restart any time; clients rejoin automatically.

## Deploy (one-time)

1. **DNS:** point `DOMAIN` (e.g. `play.example.com`) at TOWER's public IP.
2. **Config:** `cp .env.example .env` and set `DOMAIN`. Set `TURN_EXTERNAL_IP` only if TOWER is behind a
   router. Leave `TURN_SECRET` unset to auto-generate.
3. **Firewall (open on TOWER):**
   - TCP **80, 443** (Caddy / `wss://` / `/turn`)
   - UDP+TCP **3478**, TCP **5349** (STUN/TURN / `turns://`)
   - UDP **49152–65535** (TURN relay range)
4. **Run:** `docker compose up -d --build`

## Verify

```bash
curl https://$DOMAIN/healthz                 # {"status":"ok",...}
curl https://$DOMAIN/turn                     # {"username","credential","uris":[...]}
docker compose ps                             # broker healthy; all up
docker compose logs -f coturn                 # "turns:// enabled (cert found)"
```

WebRTC relay check (browser console, on an HTTPS page): create an `RTCPeerConnection` with
`iceTransportPolicy:"relay"` and the `/turn` ICE servers; you should gather `relay` candidates.

## Maintenance: none

- Caddy auto-renews TLS; coturn's watcher reloads the renewed cert automatically (SIGHUP), or restarts
  to enable `turns://` if the cert appears after first boot.
- `restart: unless-stopped` + the broker `HEALTHCHECK` recover from crashes/reboots.

## Client

Build the app with `VITE_BROKER_URL=wss://$DOMAIN`. The client fetches TURN credentials from
`https://$DOMAIN/turn` at join and falls back to STUN-only if it is unreachable. Manual override:
the in-app broker URL field (persisted to `localStorage`).

## Scaling (far off)

Single-process, in-memory — ample for current scale. If ever needed, add Redis pub/sub to fan messages
across broker instances behind a load balancer.
````

- [ ] **Step 2: Commit**

```bash
git add server/README.md
git commit -m "docs(server): TOWER runbook (one-command deploy, zero maintenance)"
```

---

### Task 12: Client — `fetchIceServers` helper (`turn.ts`)

**Files:**
- Create: `ui/src/multiplayer/turn.ts`
- Test: `ui/src/multiplayer/turn.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/multiplayer/turn.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchIceServers } from "./turn";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const STUN = "stun:stun.l.google.com:19302";

describe("fetchIceServers", () => {
  it("derives the https base and merges the TURN server on success", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        username: "123", credential: "abc",
        uris: ["turn:d:3478?transport=udp", "turns:d:5349?transport=tcp"],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const servers = await fetchIceServers("wss://play.example.com");

    expect(fetchMock).toHaveBeenCalledWith("https://play.example.com/turn");
    expect(servers[0]).toEqual({ urls: STUN });
    expect(servers[1]).toEqual({
      urls: ["turn:d:3478?transport=udp", "turns:d:5349?transport=tcp"],
      username: "123", credential: "abc",
    });
  });

  it("maps ws:// to http:// for the credential fetch", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    await fetchIceServers("ws://127.0.0.1:8788");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8788/turn");
  });

  it("falls back to STUN-only on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })) as unknown as typeof fetch);
    const servers = await fetchIceServers("wss://d");
    expect(servers).toEqual([{ urls: STUN }]);
  });

  it("falls back to STUN-only when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }) as unknown as typeof fetch);
    const servers = await fetchIceServers("wss://d");
    expect(servers).toEqual([{ urls: STUN }]);
  });

  it("falls back to STUN-only on a malformed payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ username: "x" }) })) as unknown as typeof fetch);
    const servers = await fetchIceServers("wss://d");
    expect(servers).toEqual([{ urls: STUN }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ui test -- turn`
Expected: FAIL — cannot find module `./turn`.

- [ ] **Step 3: Implement `ui/src/multiplayer/turn.ts`**

```ts
/**
 * fetchIceServers — fetch short-lived TURN credentials from the broker's /turn
 * endpoint and build the RTCIceServer list. Falls back to STUN-only on any
 * failure so multiplayer still works (just without relay) if /turn is down.
 */
import { DEFAULT_ICE_SERVERS } from "./peerManager";

interface TurnPayload {
  username?: unknown;
  credential?: unknown;
  uris?: unknown;
}

function httpBase(brokerWsUrl: string): string {
  // ws:// -> http://, wss:// -> https://; strip trailing slashes
  return brokerWsUrl.replace(/^ws/, "http").replace(/\/+$/, "");
}

export async function fetchIceServers(brokerWsUrl: string): Promise<RTCIceServer[]> {
  try {
    const res = await fetch(httpBase(brokerWsUrl) + "/turn");
    if (!res.ok) return DEFAULT_ICE_SERVERS;
    const data = (await res.json()) as TurnPayload;
    if (
      !data ||
      !Array.isArray(data.uris) ||
      typeof data.username !== "string" ||
      typeof data.credential !== "string"
    ) {
      return DEFAULT_ICE_SERVERS;
    }
    return [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: data.uris as string[], username: data.username, credential: data.credential },
    ];
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ui test -- turn`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add ui/src/multiplayer/turn.ts ui/src/multiplayer/turn.test.ts
git commit -m "feat(ui): fetchIceServers — TURN creds from broker with STUN fallback"
```

---

### Task 13: Client wiring — default broker URL + use fetched ICE servers

**Files:**
- Modify: `ui/src/multiplayer/store.ts` (default broker URL from `VITE_BROKER_URL`; export `readBrokerUrl`)
- Modify: `ui/src/views/Multiplayer.tsx` (fetch ICE servers in `handleJoin`, pass to `PeerManager`)
- Test: `ui/src/multiplayer/store.test.ts` (add an env-default case)

- [ ] **Step 1: Write the failing test (append to `store.test.ts`)**

```ts
import { readBrokerUrl } from "./store";

describe("readBrokerUrl default", () => {
  it("uses VITE_BROKER_URL when set and no localStorage override", () => {
    localStorage.removeItem("granbridge.mp.brokerUrl");
    vi.stubEnv("VITE_BROKER_URL", "wss://play.example.com");
    expect(readBrokerUrl()).toBe("wss://play.example.com");
    vi.unstubAllEnvs();
  });

  it("falls back to localhost when neither is set", () => {
    localStorage.removeItem("granbridge.mp.brokerUrl");
    vi.unstubAllEnvs();
    expect(readBrokerUrl()).toBe("ws://127.0.0.1:8788");
  });
});
```

(Ensure `vi` is imported in the test file — it already imports from `vitest`. Add `readBrokerUrl` to the existing import line if you prefer a single import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ui test -- store`
Expected: FAIL — `readBrokerUrl` is not exported.

- [ ] **Step 3: Modify `ui/src/multiplayer/store.ts`**

Replace the `readBrokerUrl` function:

```ts
export function readBrokerUrl(): string {
  const fallback =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_BROKER_URL ?? "ws://127.0.0.1:8788";
  try {
    return localStorage.getItem(LS_BROKER_URL) ?? fallback;
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ui test -- store`
Expected: PASS

- [ ] **Step 5: Wire the fetch into `ui/src/views/Multiplayer.tsx`**

Add the import near the other `./multiplayer` imports (alongside `PeerManager`):

```ts
import { fetchIceServers } from "../multiplayer/turn";
```

In `handleJoin`, replace this block:

```ts
    // Construct broker client
    const bc = new BrokerClient(brokerInput.trim() || "ws://127.0.0.1:8788");
    brokerRef.current = bc;

    bc.onJoined((self: PeerInfo, initialPeers: PeerInfo[]) => {
      setSelfId(self.peer_id);
      setPeers(initialPeers);
      setMpStatus("in_room");

      // Start peer manager
      const pm = new PeerManager(bc, self.peer_id, stream);
```

with:

```ts
    // Resolve broker URL once; fetch TURN creds (STUN-only fallback inside).
    const url = brokerInput.trim() || useMpStore.getState().brokerUrl;
    const iceServers = await fetchIceServers(url);

    // Construct broker client
    const bc = new BrokerClient(url);
    brokerRef.current = bc;

    bc.onJoined((self: PeerInfo, initialPeers: PeerInfo[]) => {
      setSelfId(self.peer_id);
      setPeers(initialPeers);
      setMpStatus("in_room");

      // Start peer manager (with TURN if /turn was reachable)
      const pm = new PeerManager(bc, self.peer_id, stream, iceServers);
```

(`useMpStore` is already imported in this file. If for some reason it is not, add `import { useMpStore } from "../multiplayer/store";`.)

- [ ] **Step 6: Run the full UI suite + typecheck/build**

Run: `npm --prefix ui test`
Expected: all green (existing 217 + new turn/store cases).
Run: `npm --prefix ui run build`
Expected: `tsc -b` clean + Vite build succeeds.

- [ ] **Step 7: Commit**

```bash
git add ui/src/multiplayer/store.ts ui/src/multiplayer/store.test.ts ui/src/views/Multiplayer.tsx
git commit -m "feat(ui): default broker URL via VITE_BROKER_URL + use fetched TURN ICE servers"
```

---

### Task 14: Integration — full suites, BUILD-LOG, finish

**Files:**
- Modify: `docs/BUILD-LOG.md`

- [ ] **Step 1: Run every suite**

Run: `python -m pytest server/tests -v`
Expected: all green (turn, config, http, broker, broker_caps).
Run: `python -m pytest -q`
Expected: the existing main suite (188) still green (no regressions; broker tests live under `server/`).
Run: `npm --prefix ui test`
Expected: all green.
Run: `npm --prefix ui run build`
Expected: clean.

- [ ] **Step 2: Append a BUILD-LOG entry**

Add under the latest section of `docs/BUILD-LOG.md`:

```markdown
### MP — Broker + coturn for real TOWER deployment ✅
Spec `docs/superpowers/specs/2026-05-22-mp-broker-tower-deploy-design.md`; plan
`docs/superpowers/plans/2026-05-22-broker-tower-deploy.md`. Built on `broker-tower-deploy`.

- **Contained stack:** one `docker compose` (init + caddy + broker + coturn). Only `DOMAIN` required;
  `TURN_SECRET` auto-generates onto a shared volume. **Zero recurring maintenance** (Caddy auto-renews;
  coturn watcher reloads the cert via SIGHUP / restart).
- **Broker:** split into `turn.py` (HMAC REST creds) + `config.py` + `http.py`; single-port WS+HTTP
  (`/turn`, `/healthz` via `process_request`); hardened (64 KiB frame cap, room-count cap → `server_full`,
  optional Origin allowlist, structured logging, graceful SIGTERM). Pinned `websockets==15.0.1`,
  non-root image + HEALTHCHECK.
- **coturn:** `turn://` + `turns://` (reusing Caddy's Let's Encrypt cert), `--external-ip` for NAT,
  RFC1918 `--denied-peer-ip` SSRF hardening, pinned image.
- **Client:** `fetchIceServers` pulls short-lived TURN creds from `/turn` (STUN-only fallback); broker
  URL defaults via `VITE_BROKER_URL`.
- **Tests:** +N server (turn/config/http/caps) and +N UI (turn/store); existing suites green; UI build
  clean. Real TLS/TURN traversal is manual-verify on TOWER (runbook in `server/README.md`).
```

(Replace `+N` with the actual counts after running the suites.)

- [ ] **Step 3: Commit**

```bash
git add docs/BUILD-LOG.md
git commit -m "docs: BUILD-LOG entry for broker + coturn TOWER deploy"
```

- [ ] **Step 4: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to choose how to integrate `broker-tower-deploy` (fast-forward merge to `main` + push, per the project's established flow).

---

## Self-Review

**Spec coverage** (each spec section → task):
- TLS via Caddy → Tasks 7, 8. TURN cred endpoint → Tasks 1, 3. coturn config/SSRF/external-IP/turns → Task 9. Broker hardening (frame cap, room cap, origins, logging, graceful, /healthz) → Tasks 3, 4, 5, 6. Reproducibility (pins, non-root, no `version:`) → Tasks 6, 7. Operability (one-var config, auto-secret, zero-touch reload, self-healing) → Tasks 7, 9, 6. Client wiring (fetch creds, fallback, `VITE_BROKER_URL`) → Tasks 12, 13. Testing strategy → tests in 1–5, 12, 13; manual-verify → Task 11 runbook. Local-only profiles/stats → no datastore added (honored by omission). ✔ no gaps.

**Placeholder scan:** `+N` in the BUILD-LOG entry (Task 14) is intentionally filled in after counting; all code blocks are complete. No TBD/TODO/"handle errors" left.

**Type/name consistency:** `make_turn_credentials(secret, domain, ttl, now)` used identically in `turn.py`, `http.py` caller, and tests. `BrokerServer(host, port, room_size_cap, *, max_rooms, max_size, allowed_origins, turn_secret, turn_domain, turn_ttl)` matches its construction in `__main__.py`, `_http_route`, and all tests. `json_response(status_code, payload, reason)` and `origin_allowed(origin, allowed)` consistent across `http.py`, `broker.py`, tests. `fetchIceServers(brokerWsUrl)` and `readBrokerUrl()` consistent across client code + tests. `/secrets/turn_secret`, `caddy_data`, and the `${DOMAIN}` env name are consistent across compose, entrypoint, Caddyfile, and config defaults. ✔
