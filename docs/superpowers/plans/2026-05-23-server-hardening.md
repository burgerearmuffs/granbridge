# Server Hardening v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add rate limiting (broker), relay quotas (coturn), and ACME email wiring to the GRANBRIDGE server stack — closing the public-endpoint hardening gaps after `server-v0.1.0`.

**Architecture:** In-process rate limiting in the broker (zero deps), keyed by the real client IP from Caddy's `X-Real-IP`. coturn gains `--total-quota`/`--max-bps`. Caddy gains the `X-Real-IP` header + an ACME `email`. All limits/quotas are env-configurable; `0` disables a limit.

**Tech Stack:** Python 3.12 + `websockets` 15, coturn, Caddy 2, Docker Compose.

**Branch:** `server-hardening`. **Spec:** `docs/superpowers/specs/2026-05-23-server-hardening-design.md`.

**Verification note:** Python tests run locally; Caddy/coturn validated in-image (Docker available); real traversal is manual-verify on TOWER. Commit messages end with `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

---

### Task 1: Rate limiter + client-IP helper (`ratelimit.py`)

**Files:** Create `server/granbridge_broker/ratelimit.py`; Test `server/tests/test_ratelimit.py`.

- [ ] **Step 1: Failing test** — `server/tests/test_ratelimit.py`:

```python
from granbridge_broker.ratelimit import RateLimiter, client_ip


def test_allows_under_limit_then_blocks_at_limit():
    rl = RateLimiter(limit=2, window=60.0)
    assert rl.allow("a", 1000.0) is True
    assert rl.allow("a", 1000.1) is True
    assert rl.allow("a", 1000.2) is False   # 3rd in window → blocked


def test_window_slides():
    rl = RateLimiter(limit=1, window=10.0)
    assert rl.allow("a", 1000.0) is True
    assert rl.allow("a", 1005.0) is False    # still in window
    assert rl.allow("a", 1011.0) is True     # old event aged out


def test_keys_are_independent():
    rl = RateLimiter(limit=1, window=60.0)
    assert rl.allow("a", 1000.0) is True
    assert rl.allow("b", 1000.0) is True


def test_zero_or_negative_limit_disables():
    rl = RateLimiter(limit=0, window=60.0)
    for i in range(100):
        assert rl.allow("a", 1000.0 + i) is True


def test_prune_drops_idle_keys():
    rl = RateLimiter(limit=5, window=10.0)
    rl.allow("a", 1000.0)
    rl.prune(1020.0)                          # 'a' idle past the window
    assert rl.key_count() == 0


def test_client_ip_prefers_x_real_ip():
    assert client_ip({"X-Real-IP": "1.2.3.4"}, ("10.0.0.1", 555)) == "1.2.3.4"


def test_client_ip_falls_back_to_remote_then_unknown():
    assert client_ip({}, ("10.0.0.1", 555)) == "10.0.0.1"
    assert client_ip({}, None) == "unknown"
```

- [ ] **Step 2: Run, expect fail** — `python -m pytest server/tests/test_ratelimit.py -v` → `ModuleNotFoundError`.

- [ ] **Step 3: Implement** — `server/granbridge_broker/ratelimit.py`:

```python
"""In-process rate limiting (zero deps) for the public broker endpoints.

RateLimiter is a sliding-window counter keyed by an arbitrary string (client IP
or peer id). limit <= 0 disables it (always allows). The clock is passed in so
callers (and tests) stay deterministic.
"""
from __future__ import annotations

from collections import deque
from typing import Optional


class RateLimiter:
    def __init__(self, limit: int, window: float) -> None:
        self._limit = limit
        self._window = window
        self._events: dict[str, deque[float]] = {}

    def allow(self, key: str, now: float) -> bool:
        if self._limit <= 0:
            return True
        dq = self._events.get(key)
        if dq is None:
            dq = deque()
            self._events[key] = dq
        cutoff = now - self._window
        while dq and dq[0] <= cutoff:
            dq.popleft()
        if len(dq) >= self._limit:
            return False
        dq.append(now)
        return True

    def prune(self, now: float) -> None:
        """Drop keys whose events have all aged out (bounds memory)."""
        cutoff = now - self._window
        for key in list(self._events):
            dq = self._events[key]
            while dq and dq[0] <= cutoff:
                dq.popleft()
            if not dq:
                del self._events[key]

    def key_count(self) -> int:
        return len(self._events)


def client_ip(headers, remote_address: Optional[tuple]) -> str:
    """Resolve the client IP. Prefer X-Real-IP (set authoritatively by Caddy);
    fall back to the socket peer host, then 'unknown'. Works with any object
    exposing .get (websockets Headers or a plain dict)."""
    xri = headers.get("X-Real-IP")
    if xri:
        return xri.split(",")[0].strip()
    if remote_address:
        return remote_address[0]
    return "unknown"
```

- [ ] **Step 4: Run, expect pass** — `python -m pytest server/tests/test_ratelimit.py -v` → all pass.

- [ ] **Step 5: Commit** — `git add server/granbridge_broker/ratelimit.py server/tests/test_ratelimit.py && git commit -m "feat(broker): in-process RateLimiter + client_ip helper

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"`

---

### Task 2: Wire rate limiting into config + broker + entrypoint

**Files:** Modify `server/granbridge_broker/config.py`, `server/granbridge_broker/broker.py`, `server/granbridge_broker/__main__.py`; Test `server/tests/test_rate_limits.py`.

- [ ] **Step 1: Failing test** — `server/tests/test_rate_limits.py`:

```python
import asyncio, json, pytest, websockets
from granbridge_broker.broker import BrokerServer
from granbridge_broker.config import from_env

FROZEN = 1000.0

async def _recv(ws): return json.loads(await asyncio.wait_for(ws.recv(), timeout=1))
async def _join(ws, room, pw, pid):
    await ws.send(json.dumps({"type":"join","room":room,"password":pw,"player":{"id":pid,"name":pid}}))


def test_config_rate_defaults():
    cfg = from_env({"TURN_SECRET": "x", "DOMAIN": "d"})
    assert cfg.turn_rate_per_min == 30
    assert cfg.conn_rate_per_min == 60
    assert cfg.msg_rate_per_sec == 20


def test_turn_endpoint_rate_limited():
    s = BrokerServer("127.0.0.1", 0, turn_secret="sek", turn_domain="d",
                     turn_rate_per_min=2, clock=lambda: FROZEN)
    assert s._http_route("/turn", "1.2.3.4").status_code == 200
    assert s._http_route("/turn", "1.2.3.4").status_code == 200
    assert s._http_route("/turn", "1.2.3.4").status_code == 429   # 3rd over limit
    assert s._http_route("/turn", "9.9.9.9").status_code == 200   # different IP ok


@pytest.fixture
async def server():
    s = BrokerServer("127.0.0.1", 8797, conn_rate_per_min=2, msg_rate_per_sec=3,
                     clock=lambda: FROZEN)
    await s.start()
    yield s
    await s.stop()

async def test_ws_connect_rate_limited(server):
    a = await websockets.connect("ws://127.0.0.1:8797")
    b = await websockets.connect("ws://127.0.0.1:8797")
    try:
        with pytest.raises(websockets.exceptions.InvalidStatus):
            await websockets.connect("ws://127.0.0.1:8797")   # 3rd over limit → 429
    finally:
        await a.close(); await b.close()

async def test_message_flood_dropped(server):
    a = await websockets.connect("ws://127.0.0.1:8797")
    b = await websockets.connect("ws://127.0.0.1:8797")
    try:
        await _join(a, "r", "p", "A"); await _recv(a)
        await _join(b, "r", "p", "B"); await _recv(b); await _recv(a)
        for _ in range(5):
            await a.send(json.dumps({"type":"msg","payload":{"x":1}}))
        got = 0
        try:
            while True:
                await asyncio.wait_for(b.recv(), timeout=0.3); got += 1
        except asyncio.TimeoutError:
            pass
        assert got == 3   # msg_rate_per_sec=3 at the frozen clock → 3 relayed, 2 dropped
    finally:
        await a.close(); await b.close()
```

- [ ] **Step 2: Run, expect fail** — `python -m pytest server/tests/test_rate_limits.py -v` → fails (config fields + kwargs missing).

- [ ] **Step 3a: `config.py`** — add three fields to `BrokerConfig` (after `turn_ttl`):

```python
    turn_rate_per_min: int
    conn_rate_per_min: int
    msg_rate_per_sec: int
```

and in `from_env`, add to the `BrokerConfig(...)` call (after `turn_ttl=...`):

```python
        turn_rate_per_min=int(env.get("TURN_RATE_PER_MIN", "30")),
        conn_rate_per_min=int(env.get("CONN_RATE_PER_MIN", "60")),
        msg_rate_per_sec=int(env.get("MSG_RATE_PER_SEC", "20")),
```

- [ ] **Step 3b: `broker.py` imports** — add near the other `granbridge_broker` imports:

```python
from granbridge_broker.ratelimit import RateLimiter, client_ip
```

(`time` is already imported.)

- [ ] **Step 3c: `broker.py` constructor** — add these keyword-only params (after `turn_ttl: int = 86400,`) and build limiters. Insert the params in the `*,`-only block and add the limiter setup at the end of `__init__`:

```python
        turn_rate_per_min: int = 0,
        conn_rate_per_min: int = 0,
        msg_rate_per_sec: int = 0,
        clock=time.time,
```

At the end of `__init__` body:

```python
        self._clock = clock
        self._turn_limiter = RateLimiter(turn_rate_per_min, 60.0)
        self._conn_limiter = RateLimiter(conn_rate_per_min, 60.0)
        self._msg_limiter = RateLimiter(msg_rate_per_sec, 1.0)
```

(Defaults are `0` = disabled, so existing tests that don't pass these are unaffected.)

- [ ] **Step 3d: `broker.py` `_http_route`** — change signature and add the `/turn` limit + use `self._clock()`:

```python
    def _http_route(self, path: str, client_ip: str = "-"):
        if path == "/healthz":
            return json_response(
                200,
                {"status": "ok", "rooms": len(self._rooms), "peers": len(self._peers)},
            )
        if path == "/turn":
            if not self._turn_limiter.allow(client_ip, self._clock()):
                return json_response(429, {"error": "rate_limited"}, reason="Too Many Requests")
            return json_response(
                200,
                make_turn_credentials(
                    self._turn_secret, self._turn_domain, self._turn_ttl, self._clock()
                ),
            )
        return None
```

- [ ] **Step 3e: `broker.py` `_process_request`** — extract IP, pass to `_http_route`, add the WS connect limit before the origin check:

```python
    def _process_request(self, connection, request):
        ip = client_ip(request.headers, connection.remote_address)
        resp = self._http_route(request.path, ip)
        if resp is not None:
            return resp
        # WebSocket upgrade: per-IP connection rate limit
        if not self._conn_limiter.allow(ip, self._clock()):
            self._log.warning("rate-limited WS upgrade ip=%s", ip)
            return json_response(429, {"error": "rate_limited"}, reason="Too Many Requests")
        if self._allowed_origins is not None:
            origin = request.headers.get("Origin")
            if not origin_allowed(origin, self._allowed_origins):
                self._log.warning("rejected WS upgrade: forbidden origin %r", origin)
                return json_response(403, {"error": "forbidden_origin"}, reason="Forbidden")
        return None
```

- [ ] **Step 3f: `broker.py` message flood** — in `_handle`, drop over-limit `signal` and `msg`. In the `elif mtype == "signal":` branch, immediately after the `if member is None:` guard block, insert:

```python
                    if not self._msg_limiter.allow(peer_id, self._clock()):
                        self._log.warning("dropped signal flood peer=%s", peer_id)
                        continue
```

In the `elif mtype == "msg":` branch, immediately after its `if member is None:` guard block, insert the same check with `"dropped msg flood peer=%s"`.

- [ ] **Step 3g: `__main__.py`** — pass the new fields into `BrokerServer(...)` (after `turn_ttl=cfg.turn_ttl,`):

```python
        turn_rate_per_min=cfg.turn_rate_per_min,
        conn_rate_per_min=cfg.conn_rate_per_min,
        msg_rate_per_sec=cfg.msg_rate_per_sec,
```

- [ ] **Step 4: Run** — `python -m pytest server/tests -v` → all pass (new rate tests + existing 16 unaffected).

- [ ] **Step 5: Commit** — `git add server/granbridge_broker/config.py server/granbridge_broker/broker.py server/granbridge_broker/__main__.py server/tests/test_rate_limits.py && git commit -m "feat(broker): per-IP rate limits on /turn + WS connects + message flood

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"`

---

### Task 3: Caddyfile — X-Real-IP + ACME email

**Files:** Modify `server/Caddyfile`.

- [ ] **Step 1: Determine the empty-safe ACME email form** — Caddy errors on a bare `email` directive, so test both forms against the real image. From `server/`:

```
docker run --rm -e DOMAIN=test.example.com -e ACME_EMAIL=me@test.example.com -v "${PWD}/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.8 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker run --rm -e DOMAIN=test.example.com -v "${PWD}/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.8 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Use the global-options form with an env placeholder default so it is valid whether `ACME_EMAIL` is set or empty. Write `server/Caddyfile`:

```
# Caddy auto-provisions + renews a Let's Encrypt cert for $DOMAIN and reverse-proxies
# WebSocket (wss:// play) + the plain-HTTP /turn and /healthz endpoints to the broker.
# X-Real-IP gives the broker the true client IP (set here, so it can't be spoofed) for
# rate limiting. Set ACME_EMAIL in .env to receive renewal/expiry notices.

{
	email {$ACME_EMAIL:}
}

{$DOMAIN} {
	reverse_proxy broker:8788 {
		header_up X-Real-IP {remote_host}
	}
}
```

If `{$ACME_EMAIL:}` (empty default) fails `caddy validate` when `ACME_EMAIL` is unset, instead omit the global block and document `ACME_EMAIL` as requiring a manual `email` line — but only after confirming with the two `caddy validate` runs above. Record which form validated in both cases.

- [ ] **Step 2: Validate** — both `docker run ... caddy validate` commands above print "Valid configuration".

- [ ] **Step 3: Commit** — `git add server/Caddyfile && git commit -m "harden(caddy): set X-Real-IP for rate limiting + wire ACME email

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"`

---

### Task 4: Compose + .env.example — new env knobs

**Files:** Modify `server/docker-compose.yml`, `server/.env.example`.

- [ ] **Step 1: `docker-compose.yml`** — add env to the relevant services (keep everything else identical):

**`caddy` service** — Caddy can't take an *optional* email via a static Caddyfile (an empty `email` is a parse error), so inject the email global block at startup only when `ACME_EMAIL` is set. Replace the existing `caddy` service block with this (same image/ports/volumes/networks/depends_on; the additions are `environment.ACME_EMAIL`, `entrypoint`, and `command`):
```yaml
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
      ACME_EMAIL: "${ACME_EMAIL:-}"
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        if [ -n "$$ACME_EMAIL" ]; then
          { printf '{\n\temail %s\n}\n\n' "$$ACME_EMAIL"; cat /etc/caddy/Caddyfile; } > /tmp/Caddyfile
          exec caddy run --config /tmp/Caddyfile --adapter caddyfile
        fi
        exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [backend]
```
(`$$ACME_EMAIL` is compose-escaped to `$ACME_EMAIL` for the shell; `exec` makes `caddy` PID 1 for clean signals.)

Then tidy `server/Caddyfile`: replace the multi-line "ACME email … uncomment the global block" comment with a single line — `# ACME email: set ACME_EMAIL in .env; the caddy service injects the email global block at startup.` Leave the `X-Real-IP` comment and the site block unchanged.

`broker.environment` (add alongside the existing keys):
```yaml
      TURN_RATE_PER_MIN: "${TURN_RATE_PER_MIN:-30}"
      CONN_RATE_PER_MIN: "${CONN_RATE_PER_MIN:-60}"
      MSG_RATE_PER_SEC: "${MSG_RATE_PER_SEC:-20}"
```

`coturn.environment` (add alongside the existing keys):
```yaml
      TURN_TOTAL_QUOTA: "${TURN_TOTAL_QUOTA:-200}"
      TURN_MAX_BPS: "${TURN_MAX_BPS:-0}"
```

- [ ] **Step 2: Validate** — from `server/`: `$env:DOMAIN="test.example.com"; docker compose config` renders cleanly (exit 0), no `version` warning. Also verify the **email-injected** config validates: generate it and run `caddy validate` against the real image:
  ```sh
  { printf '{\n\temail me@test.example.com\n}\n\n'; cat server/Caddyfile; } > /tmp/cf
  docker run --rm -e DOMAIN=test.example.com -v "/tmp/cf:/etc/caddy/Caddyfile:ro" caddy:2.8 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  ```
  Expect "Valid configuration" (confirms the injected `email` block parses). The unset case is the plain `server/Caddyfile`, already validated in Task 3.

- [ ] **Step 3: `.env.example`** — append (after the existing optional block):

```bash

# Hardening (optional; shown values are the defaults):
# ACME_EMAIL=you@example.com   # Let's Encrypt notices (recommended)
# TURN_RATE_PER_MIN=30         # /turn requests per IP per minute (0 = disabled)
# CONN_RATE_PER_MIN=60         # WebSocket connects per IP per minute (0 = disabled)
# MSG_RATE_PER_SEC=20          # signal/msg messages per connection per second (0 = disabled)
# TURN_TOTAL_QUOTA=200         # coturn: max simultaneous relay allocations
# TURN_MAX_BPS=0               # coturn: per-allocation bytes/sec cap (0 = unlimited)
```

- [ ] **Step 4: Commit** — `git add server/docker-compose.yml server/.env.example && git commit -m "feat(server): env knobs for rate limits + coturn quotas + ACME email

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"`

---

### Task 5: coturn entrypoint — relay quotas

**Files:** Modify `server/coturn/entrypoint.sh`.

- [ ] **Step 1: Add quota flags** — in `server/coturn/entrypoint.sh`, append `--total-quota` and (conditionally) `--max-bps` to the `COMMON` flags. After the existing `TURN_EXTERNAL_IP` line (`[ -n "${TURN_EXTERNAL_IP:-}" ] && COMMON="$COMMON --external-ip=$TURN_EXTERNAL_IP"`), add:

```sh
COMMON="$COMMON --total-quota=${TURN_TOTAL_QUOTA:-200}"
[ -n "${TURN_MAX_BPS:-}" ] && [ "${TURN_MAX_BPS:-0}" != "0" ] && COMMON="$COMMON --max-bps=$TURN_MAX_BPS"
```

Preserve LF line endings.

- [ ] **Step 2: Validate** — `python -c "d=open('server/coturn/entrypoint.sh','rb').read(); print('CRLF' if b'\r\n' in d else 'LF-only OK')"` → `LF-only OK`; `sh -n server/coturn/entrypoint.sh` (no output); `docker run --rm -v "${PWD}/server/coturn/entrypoint.sh:/entrypoint.sh:ro" --entrypoint sh coturn/coturn:4.6.2 -n /entrypoint.sh` (no errors). Also confirm coturn accepts the flags: `docker run --rm coturn/coturn:4.6.2 turnserver --help 2>&1 | grep -E "total-quota|max-bps"` shows both options exist.

- [ ] **Step 3: Commit** — `git add server/coturn/entrypoint.sh && git commit -m "harden(coturn): --total-quota + optional --max-bps relay quotas

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"`

---

### Task 6: README hardening docs + integration

**Files:** Modify `server/README.md`, `docs/BUILD-LOG.md`.

- [ ] **Step 1: README** — add a "Hardening" subsection to `server/README.md` (after the "Maintenance: none" section) documenting: per-IP rate limits on `/turn` and WS connects + per-connection message flood (env: `TURN_RATE_PER_MIN`, `CONN_RATE_PER_MIN`, `MSG_RATE_PER_SEC`; `0` disables); coturn relay quotas (`TURN_TOTAL_QUOTA`, `TURN_MAX_BPS`); and that `ALLOWED_ORIGINS` can be set to a comma-separated allowlist for browser-only deployments (leave unset for the native app, which sends a null origin). Note rate limiting relies on Caddy's `X-Real-IP`.

- [ ] **Step 2: Run every suite** —
  `python -m pytest server/tests -v` (all pass; report count) ·
  `python -m pytest -q` (main suite, no regression — run `pip install -e ".[dev]"` first if `structlog`/`bleak` missing) ·
  `npm --prefix ui test` (unchanged, still passes) ·
  `npm --prefix ui run build` (clean).
  If any fail, STOP and report BLOCKED.

- [ ] **Step 3: BUILD-LOG** — append a concise entry to `docs/BUILD-LOG.md` titled "Server hardening v2" summarizing: per-IP rate limits (broker, via X-Real-IP), coturn `--total-quota`/`--max-bps`, ACME email wired, ALLOWED_ORIGINS documented; spec/plan paths; the actual new server-test count.

- [ ] **Step 4: Commit** — `git add server/README.md docs/BUILD-LOG.md && git commit -m "docs: server hardening runbook + BUILD-LOG entry

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"`

- [ ] **Step 5: Finish** — controller runs `superpowers:finishing-a-development-branch` (merge to main + push; release decision deferred to the user).

---

## Self-Review

**Spec coverage:** rate limiting (broker, X-Real-IP) → Tasks 1,2,3; coturn quotas → Tasks 4,5; ACME email → Tasks 3,4; ALLOWED_ORIGINS doc → Task 6. ✔
**Placeholder scan:** Task 3 leaves the exact ACME-email Caddyfile form to be confirmed by `caddy validate` (with a concrete primary form + a documented fallback) — this is an empirical decision, not a placeholder; the BUILD-LOG count in Task 6 is filled in after the run. No other gaps.
**Type/name consistency:** `RateLimiter(limit, window)` / `.allow(key, now)` / `.prune(now)` / `.key_count()` and `client_ip(headers, remote_address)` are used identically in `ratelimit.py`, `broker.py`, and tests. `_http_route(self, path, client_ip="-")` matches its callers (existing `test_http.py` uses the 1-arg default; new tests pass the IP). New config fields `turn_rate_per_min`/`conn_rate_per_min`/`msg_rate_per_sec` are consistent across `config.py`, `broker.py` kwargs, `__main__.py`, compose env, and `.env.example`. coturn env `TURN_TOTAL_QUOTA`/`TURN_MAX_BPS` consistent across compose, entrypoint, `.env.example`, README. ✔
