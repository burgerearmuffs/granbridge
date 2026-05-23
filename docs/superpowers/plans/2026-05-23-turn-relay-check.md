# Smoke Tool — TURN Relay Auto-Check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add `check_turn_relay` to `server/smoke.py` — an authenticated TURN **Allocate** (RFC 5766 + RFC 5389 long-term auth) that proves coturn accepts the broker's REST credentials and allocates a relay, verified from the CLI with **no browser**.

**Architecture:** Pure protocol helpers + a UDP Allocate flow in `server/smoke.py`, reusing the existing STUN attribute machinery. Correctness is proven by a **docker-gated test against a real `coturn:4.6.2`** (coturn validates the MESSAGE-INTEGRITY itself, so a successful Allocate is the oracle).

**Tech Stack:** Python 3.12 stdlib (`socket`, `struct`, `os`, `hashlib`, `hmac`). **Branch:** `turn-relay-check`. **Self-approved** (autonomous mandate). Spec: `docs/superpowers/specs/2026-05-23-turn-relay-check-design.md`.

**Verification:** pure unit tests run locally; the real-coturn test runs here (docker available) and is the correctness proof. Commit trailer: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

---

### Task 1: TURN Allocate primitives + `check_turn_relay` + tests

**Files:** Modify `server/smoke.py`; Test `server/tests/test_turn_relay.py` (pure) and `server/tests/test_turn_relay_integration.py` (docker-gated).

- [ ] **Step 1: Write the failing pure tests** — `server/tests/test_turn_relay.py`:

```python
import hashlib, hmac, struct
import smoke

MAGIC = 0x2112A442


def test_long_term_key_format():
    # key = MD5("username:realm:credential")
    assert smoke._long_term_key("u", "r", "p") == hashlib.md5(b"u:r:p").digest()


def test_authed_allocate_structure_and_integrity():
    key = b"\x11" * 16
    txn = b"\x00" * 12
    msg = smoke._build_authed_allocate(txn, "1779", b"darts.aventador.io", b"nonceval", key)
    mtype, mlen = struct.unpack(">HH", msg[:4])
    assert mtype == 0x0003                    # Allocate Request
    assert mlen == len(msg) - 20              # header length covers ALL attrs incl. MESSAGE-INTEGRITY
    # MESSAGE-INTEGRITY is the last attribute (24 bytes: 4 header + 20 HMAC)
    at, al = struct.unpack(">HH", msg[-24:-20])
    assert at == 0x0008 and al == 20
    # the length-trick: HMAC-SHA1 over everything-before-the-MI-attr must equal the MI value
    assert msg[-20:] == hmac.new(key, msg[:-24], hashlib.sha1).digest()
    # required attributes present
    assert smoke._get_attr(msg, 0x0006) == b"1779"               # USERNAME
    assert smoke._get_attr(msg, 0x0014) == b"darts.aventador.io" # REALM
    assert smoke._get_attr(msg, 0x0015) == b"nonceval"           # NONCE
    assert smoke._get_attr(msg, 0x0019) == b"\x11\x00\x00\x00"   # REQUESTED-TRANSPORT (UDP)


def test_get_attr_extracts_realm_and_nonce():
    body = smoke._stun_attr(0x0014, b"test.local") + smoke._stun_attr(0x0015, b"abc123")
    resp = struct.pack(">HHI", 0x0113, len(body), MAGIC) + b"\x00" * 12 + body  # Allocate Error (401)
    assert smoke._get_attr(resp, 0x0014) == b"test.local"
    assert smoke._get_attr(resp, 0x0015) == b"abc123"
    assert smoke._get_attr(resp, 0x0099) is None


def test_parse_xor_relayed_address():
    ip_int, port = 0x0A141E28, 49152                  # 10.20.30.40:49152
    xport = port ^ (MAGIC >> 16)
    xaddr = ip_int ^ MAGIC
    val = struct.pack(">BBHI", 0x00, 0x01, xport, xaddr)
    attr = struct.pack(">HH", 0x0016, len(val)) + val  # XOR-RELAYED-ADDRESS
    resp = struct.pack(">HHI", 0x0103, len(attr), MAGIC) + b"\x00" * 12 + attr  # Allocate Success
    assert smoke.parse_xor_mapped_address(resp, 0x0016) == ("10.20.30.40", 49152)
```

- [ ] **Step 2: Run, expect fail** — `python -m pytest server/tests/test_turn_relay.py -v` → missing `_long_term_key`/`_build_authed_allocate`/`_get_attr`/`_stun_attr`.

- [ ] **Step 3: Implement in `server/smoke.py`** — add `import hashlib` and `import hmac` to the imports. Add the `attr_type` parameter to the existing `parse_xor_mapped_address` (change its signature to `def parse_xor_mapped_address(data, attr_type=0x0020):` and the inner match from `if atype == 0x0020 ...` to `if atype == attr_type ...` — nothing else changes, so the existing STUN tests still pass). Then add:

```python
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
        sock.sendto(_build_initial_allocate(os.urandom(12)), (host, port))
        challenge, _ = sock.recvfrom(2048)
        realm = _get_attr(challenge, 0x0014)
        nonce = _get_attr(challenge, 0x0015)
        if realm is None or nonce is None:
            mt = struct.unpack(">H", challenge[:2])[0] if len(challenge) >= 2 else 0
            return False, f"turn relay: no realm/nonce in challenge (msg type {hex(mt)})"
        key = _long_term_key(username, realm.decode("utf-8", "replace"), credential)
        sock.sendto(_build_authed_allocate(os.urandom(12), username, realm, nonce, key), (host, port))
        reply, _ = sock.recvfrom(2048)
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
```

Also extract the `/turn` fetch so `run()` can reuse it, and wire the relay check in. Add `_fetch_turn` and refactor `check_turn` to use it (its signature/behavior are unchanged, so `test_smoke.py` still passes):

```python
def _fetch_turn(http_base: str, timeout: float = 5.0) -> dict:
    with urllib.request.urlopen(http_base + "/turn", timeout=timeout) as resp:
        return json.loads(resp.read())
```

In `check_turn`, replace the inline `urlopen(...)` fetch with `data = _fetch_turn(http_base)` inside its existing `try/except` (keep the validation + return string identical).

In `run()`, add the relay check after `check_stun` (fetch creds once; on fetch failure, record a clean FAIL):

```python
async def run(ws_url: str) -> bool:
    base = _http_base(ws_url)
    host = urlparse(ws_url).hostname or ""
    results = [check_health(base), check_turn(base), check_stun(host, 3478)]
    try:
        creds = _fetch_turn(base)
        results.append(check_turn_relay(host, 3478, creds["username"], creds["credential"]))
    except Exception as exc:
        results.append((False, f"turn relay: couldn't fetch creds: {exc}"))
    results.append(await check_ws(ws_url))
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
```

- [ ] **Step 4: Run pure tests** — `python -m pytest server/tests/test_turn_relay.py server/tests/test_smoke.py server/tests/test_smoke_stun.py -v` → all green (new pure tests + existing smoke/STUN tests unaffected).

- [ ] **Step 5: Write the docker-gated integration test (the correctness oracle)** — `server/tests/test_turn_relay_integration.py`:

```python
import shutil, subprocess, time
import pytest
import smoke
from granbridge_broker.turn import make_turn_credentials

pytestmark = pytest.mark.skipif(shutil.which("docker") is None, reason="docker not available")

SECRET = "smoke-test-secret"
REALM = "smoke.test"
NAME = "granbridge-smoke-coturn-test"


@pytest.fixture
def coturn():
    subprocess.run(["docker", "rm", "-f", NAME], capture_output=True)
    proc = subprocess.run(
        ["docker", "run", "-d", "--name", NAME, "-p", "3478:3478/udp",
         "coturn/coturn:4.6.2", "turnserver", "-n", "--no-tls", "--no-dtls",
         "--use-auth-secret", "--static-auth-secret", SECRET, "--realm", REALM,
         "--listening-port=3478", "--listening-ip=0.0.0.0",
         "--min-port=49152", "--max-port=49200"],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stderr
    time.sleep(3)  # let coturn come up
    yield
    subprocess.run(["docker", "rm", "-f", NAME], capture_output=True)


def test_real_coturn_accepts_minted_creds(coturn):
    creds = make_turn_credentials(SECRET, REALM, ttl=300, now=time.time())
    ok, detail = smoke.check_turn_relay("127.0.0.1", 3478, creds["username"], creds["credential"])
    assert ok, detail
    assert "relay allocated" in detail or "succeeded" in detail


def test_real_coturn_rejects_bad_creds(coturn):
    ok, detail = smoke.check_turn_relay("127.0.0.1", 3478, "12345", "totally-wrong-credential")
    assert ok is False, detail
```

- [ ] **Step 6: Run the integration test + whole suite** — `python -m pytest server/tests/test_turn_relay_integration.py -v` (docker available → real coturn Allocate; the success case proves the key derivation + MI length-trick + attribute encoding are all correct, because coturn validates the HMAC). Then `python -m pytest server/tests -q` → whole suite green. If the integration test fails, the protocol is wrong — STOP and report BLOCKED with the failure detail.

- [ ] **Step 7: Commit**

```bash
git add server/smoke.py server/tests/test_turn_relay.py server/tests/test_turn_relay_integration.py
git commit -m "feat(server): TURN relay auto-check (authenticated Allocate, verified vs real coturn)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Docs + finish

**Files:** Modify `server/README.md`, `docs/BUILD-LOG.md`.

- [ ] **Step 1: README** — in the "Validate a deployment" subsection, add that the tool now also performs an **authenticated TURN Allocate** (`turn relay` line) — confirming coturn accepts the broker's credentials and allocates a relay, i.e. verifying TURN end-to-end without a browser. Note it uses UDP 3478 (turns:// 5349 relay is a future add).

- [ ] **Step 2: Suites** — `python -m pytest server/tests -q` (green) and `npm --prefix ui test` (unchanged). If any fail, STOP/BLOCKED.

- [ ] **Step 3: BUILD-LOG** — append a concise "TURN relay auto-check" note: the authenticated Allocate flow in `smoke.py` (long-term-cred MESSAGE-INTEGRITY), pure unit tests + a docker-gated real-coturn integration test (the correctness oracle), and the new server-test count.

- [ ] **Step 4: Commit** — `git add server/README.md docs/BUILD-LOG.md && git commit -m "docs: TURN relay auto-check note + BUILD-LOG

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"`

- [ ] **Step 5: Finish** — controller runs `superpowers:finishing-a-development-branch` (merge to main + **push**, since the next step is cutting server-v0.1.1 which packages from main).

---

## Self-Review

**Spec coverage:** Allocate primitives + MI length-trick → Task 1 Step 3; `check_turn_relay` two-step flow → Task 1; wired into `run()` → Task 1; pure tests + docker-gated coturn oracle → Task 1; docs → Task 2. ✔
**Placeholder scan:** integration test container args are concrete; BUILD-LOG count filled in after the run. No gaps. ✔
**Type/name consistency:** `_get_attr(data, want_type)`, `_stun_attr(atype, value)`, `_long_term_key(username, realm, credential)`, `_build_initial_allocate(txn)`, `_build_authed_allocate(txn, username, realm, nonce, key)`, `check_turn_relay(host, port, username, credential, timeout)`, `_fetch_turn(http_base)` are used identically in `smoke.py` and the tests; `parse_xor_mapped_address(data, attr_type=0x0020)` keeps its default so existing callers/tests are unaffected; `run()` keeps the SKIP/PASS/FAIL label logic. The integration test mints creds via the real `granbridge_broker.turn.make_turn_credentials`, so it validates the broker↔coturn contract end-to-end. ✔
