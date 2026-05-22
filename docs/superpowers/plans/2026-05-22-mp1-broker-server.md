# MP-1: Multiplayer Broker Server (Dockerized) — Plan

> Subagent-driven. No commits by subagent. Standalone Python app under `server/` (does NOT import
> `granbridge` — keep the image tiny). Self-hostable on TOWER. Build + unit-test the Python broker
> locally; AUTHOR the Docker files but do NOT build/run Docker here (that's the user's TOWER step).

**Goal:** A thin WebSocket broker: rooms + password + presence + WebRTC signaling relay. Stateless
except in-memory room membership. The keystone of internet multiplayer.

**Stack:** Python 3.12+, `websockets` (only dep), stdlib `hashlib`/`uuid`/`json`/`asyncio`. pytest.

---

## Task 1: Broker core

**Files:** `server/granbridge_broker/__init__.py`, `server/granbridge_broker/broker.py`, `server/tests/__init__.py`, `server/tests/test_broker.py`.

Protocol (JSON over WebSocket). Server assigns each connection a `peer_id` (uuid4 hex).
- Client → `{"type":"join","room":"R","password":"P","player":{"id":"...","name":"..."}}`
- Server → joiner: `{"type":"joined","self":"<peer_id>","peers":[{"peer_id","player"}...]}`
- Server → room (on membership change): `{"type":"peers","peers":[...]}`
- Client → `{"type":"signal","to":"<peer_id>","data":{...}}` ; Server → target: `{"type":"signal","from":"<peer_id>","data":{...}}`
- Client → `{"type":"msg","payload":{...}}` ; Server → others: `{"type":"msg","from":"<peer_id>","payload":{...}}`
- Server → `{"type":"error","code":"...","message":"..."}` (bad_password, room_full, bad_request)
- Disconnect/`{"type":"leave"}` → remove member, broadcast `peers`, reap empty room.

Rules: first joiner sets the room password (store sha256 hash); later joiners must match (else `error bad_password` + close). Room size cap default 4 (`error room_full`). Unknown/malformed messages → `error bad_request` (never crash the connection).

- [ ] **Step 1: Write `server/tests/test_broker.py`** (uses `websockets` client against a started `BrokerServer`):
```python
import asyncio, json, pytest, websockets
from granbridge_broker.broker import BrokerServer

async def _recv(ws): return json.loads(await asyncio.wait_for(ws.recv(), timeout=1))

async def _join(ws, room, pw, pid):
    await ws.send(json.dumps({"type":"join","room":room,"password":pw,"player":{"id":pid,"name":pid}}))

@pytest.fixture
async def server():
    s = BrokerServer("127.0.0.1", 8795); await s.start()
    yield s
    await s.stop()

async def test_join_creates_room_and_second_peer_sees_presence(server):
    async with websockets.connect("ws://127.0.0.1:8795") as a:
        await _join(a, "r1", "pw", "A"); ja = await _recv(a)
        assert ja["type"] == "joined" and ja["peers"] == []
        async with websockets.connect("ws://127.0.0.1:8795") as b:
            await _join(b, "r1", "pw", "B"); jb = await _recv(b)
            assert jb["type"] == "joined" and len(jb["peers"]) == 1
            # A gets a peers update naming B
            pa = await _recv(a)
            assert pa["type"] == "peers" and any(p["player"]["id"]=="B" for p in pa["peers"])

async def test_wrong_password_rejected(server):
    async with websockets.connect("ws://127.0.0.1:8795") as a:
        await _join(a, "r2", "right", "A"); await _recv(a)
        async with websockets.connect("ws://127.0.0.1:8795") as b:
            await _join(b, "r2", "WRONG", "B"); eb = await _recv(b)
            assert eb["type"] == "error" and eb["code"] == "bad_password"

async def test_signal_is_forwarded_to_target(server):
    async with websockets.connect("ws://127.0.0.1:8795") as a, websockets.connect("ws://127.0.0.1:8795") as b:
        await _join(a, "r3", "p", "A"); ja = await _recv(a)
        await _join(b, "r3", "p", "B"); jb = await _recv(b); await _recv(a)  # a's peers update
        a_id = ja["self"]
        await b.send(json.dumps({"type":"signal","to":a_id,"data":{"sdp":"x"}}))
        msg = await _recv(a)
        assert msg["type"]=="signal" and msg["data"]["sdp"]=="x" and msg["from"]==jb["self"]

async def test_msg_broadcast_to_others_not_sender(server):
    async with websockets.connect("ws://127.0.0.1:8795") as a, websockets.connect("ws://127.0.0.1:8795") as b:
        await _join(a, "r4", "p", "A"); await _recv(a)
        await _join(b, "r4", "p", "B"); await _recv(b); await _recv(a)
        await a.send(json.dumps({"type":"msg","payload":{"hello":1}}))
        m = await _recv(b)
        assert m["type"]=="msg" and m["payload"]["hello"]==1
        # sender should NOT receive its own msg
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(a.recv(), timeout=0.3)
```

- [ ] **Step 2: Implement `server/granbridge_broker/broker.py`** — a `BrokerServer(host, port)` with `async start()/stop()` (mirror the style of `websockets.asyncio.server.serve` used elsewhere in the repo) and a `Room`/registry. Track `peer_id -> (websocket, room, player)`; per-room `password_hash`, members. Handle join/signal/msg/leave + disconnect cleanup + room reaping + size cap (default 4) + `error` for bad_password/room_full/bad_request. Use `hashlib.sha256` for the password. Be fully defensive (a malformed message must not kill the server).

- [ ] **Step 3: Run** `.venv\Scripts\python -m pytest server/tests -v` (the repo venv already has `websockets`; add `server` to sys.path in the test via a `conftest.py` if needed, or run with `PYTHONPATH=server`). Expect all pass.

---

## Task 2: Entry point + packaging

**Files:** `server/granbridge_broker/__main__.py`, `server/requirements.txt`, `server/conftest.py` (if needed for import path).

- [ ] `__main__.py`: read `BROKER_HOST` (default `0.0.0.0`) + `BROKER_PORT` (default `8788`) from env; `asyncio.run` a `BrokerServer(...).start()` then wait forever. `python -m granbridge_broker` runs it.
- [ ] `requirements.txt`: `websockets>=12`.
- [ ] Ensure tests import `granbridge_broker` (add `server/conftest.py` doing `sys.path.insert(0, dirname)` or rely on `PYTHONPATH=server`; pick one and make `pytest server/tests` work from the repo root).

---

## Task 3: Docker (author only — do NOT build/run here)

**Files:** `server/Dockerfile`, `server/docker-compose.yml`, `server/.dockerignore`, `server/README.md`.

- [ ] **Dockerfile:** `FROM python:3.12-slim`; copy `server/`; `pip install -r requirements.txt`; `EXPOSE 8788`; `CMD ["python","-m","granbridge_broker"]`. Set workdir so `granbridge_broker` is importable.
- [ ] **docker-compose.yml:** service `broker` (build ., ports `8788:8788`, env BROKER_HOST/PORT, restart unless-stopped); service `coturn` (image `coturn/coturn`, host networking or UDP/TCP 3478 + a relay port range, env for realm + a static auth secret as a `${TURN_SECRET}` placeholder). Comment the TURN/UDP port-range + public-IP requirements.
- [ ] **README.md:** deploy on TOWER — `docker compose up -d --build`; expose port 8788 on the public IP (and TURN ports); set `TURN_SECRET`/realm; recommend a reverse proxy (Caddy/nginx) for `wss://` + TLS with a hostname (note clients should use `wss://` in production); how clients point at it (a `broker_url` setting). Note the broker is stateless; scale later if needed.

---

## Self-Review
- **Coverage:** rooms+password (T1), presence (T1), signaling relay (T1), generic msg relay (T1), entry/env (T2), Docker + coturn + deploy doc (T3).
- **Safety:** password hashed; malformed messages → error not crash; room cap; standalone (no granbridge import → tiny image); binds 0.0.0.0 inside the container (user controls public exposure). Broker carries signaling text only; media is P2P/TURN.
- **Not built here:** Docker image build/run (user's TOWER step); TLS/wss (documented follow-up).
