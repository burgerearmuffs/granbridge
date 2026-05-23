# Smoke Tool — STUN Reachability Check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend `server/smoke.py` with a STUN Binding check that confirms the coturn TURN server is reachable on **UDP 3478** (and returns the server-reflexive address) — catching the common deployment failure of UDP 3478 blocked by a firewall, which `/healthz` cannot detect.

**Architecture:** Pure, dependency-free STUN Binding request/parse helpers (`build_stun_binding_request`, `parse_xor_mapped_address`) + a `check_stun(host, port)` that sends one UDP Binding request and parses the response. Wired into `run()` (host derived from the broker URL, port 3478). STUN Binding needs no auth, so this is simple, low-risk protocol code. (Authenticated TURN Allocate / actual relay verification is a deliberate future follow-up.)

**Tech Stack:** Python 3.12 stdlib (`socket`, `struct`, `os`, `urllib.parse`). **Branch:** `smoke-stun-check`. **Self-approved** under the autonomous mandate.

**Verification:** Pure unit tests (encode/parse) run locally + a dead-host timeout test; real coturn reachability is exercised when the operator runs the tool against TOWER. Commit messages end with `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

---

### Task 1: STUN check + helpers + tests, wired into `run()`

**Files:** Modify `server/smoke.py`; Test `server/tests/test_smoke_stun.py`.

- [ ] **Step 1: Write the failing test** — `server/tests/test_smoke_stun.py`:

```python
import struct
import smoke

MAGIC = 0x2112A442


def test_build_binding_request_shape():
    pkt = smoke.build_stun_binding_request()
    assert len(pkt) == 20
    mtype, mlen, magic = struct.unpack(">HHI", pkt[:8])
    assert mtype == 0x0001 and mlen == 0 and magic == MAGIC
    assert len(pkt[8:20]) == 12  # transaction id


def test_parse_xor_mapped_address_roundtrip():
    # Build a Binding Response carrying XOR-MAPPED-ADDRESS for 1.2.3.4:1234
    ip_int = 0x01020304
    port = 1234
    xport = port ^ (MAGIC >> 16)
    xaddr = ip_int ^ MAGIC
    # XOR-MAPPED-ADDRESS value: reserved(B), family=IPv4(B), x-port(H), x-addr(I) = 8 bytes
    attr_val = struct.pack(">BBHI", 0x00, 0x01, xport, xaddr)
    attr = struct.pack(">HH", 0x0020, len(attr_val)) + attr_val
    txn = b"\x00" * 12
    resp = struct.pack(">HHI", 0x0101, len(attr), MAGIC) + txn + attr
    assert smoke.parse_xor_mapped_address(resp) == ("1.2.3.4", 1234)


def test_parse_returns_none_on_garbage():
    assert smoke.parse_xor_mapped_address(b"not-stun") is None


def test_check_stun_fails_on_unreachable_port():
    ok, detail = smoke.check_stun("127.0.0.1", 9, timeout=0.5)
    assert ok is False
    assert "stun" in detail.lower()
```

- [ ] **Step 2: Run, expect fail** — `python -m pytest server/tests/test_smoke_stun.py -v` → `AttributeError`/missing functions.

- [ ] **Step 3: Implement** — add to `server/smoke.py` (imports at top: `import os`, `import socket`, `import struct`, and `from urllib.parse import urlparse`):

```python
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
```

Then wire it into `run()` — derive the TURN host from the broker URL and add the check (after `check_turn`, before `check_ws`):

```python
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
```

- [ ] **Step 4: Run, expect pass** — `python -m pytest server/tests/test_smoke_stun.py -v` → all pass; then `python -m pytest server/tests -q` → whole suite green (the existing `test_smoke.py` calls the individual checks, not `run()`, so it is unaffected by the new STUN line in `run`).

- [ ] **Step 5: Commit** — `git add server/smoke.py server/tests/test_smoke_stun.py && git commit -m "feat(server): smoke tool STUN reachability check (UDP 3478)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"`

---

### Task 2: Docs + finish

**Files:** Modify `server/README.md`, `docs/BUILD-LOG.md`.

- [ ] **Step 1: README** — in the "Validate a deployment" subsection, note that the tool also checks **UDP 3478 STUN reachability** (catches a firewall blocking UDP 3478), and that running it against a full stack (broker **and** coturn) is expected — the STUN check will FAIL against a broker-only target with no coturn.

- [ ] **Step 2: Suites** — `python -m pytest server/tests -q` (green); `npm --prefix ui test` (unchanged). If any fail, STOP/BLOCKED.

- [ ] **Step 3: BUILD-LOG** — append a one-paragraph note to the existing smoke-tool entry (or a new short entry): the STUN Binding reachability check (UDP 3478) added to `smoke.py`, pure encode/parse unit tests, the new server-test count.

- [ ] **Step 4: Commit** — `git add server/README.md docs/BUILD-LOG.md && git commit -m "docs: smoke tool STUN check note + BUILD-LOG

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"`

- [ ] **Step 5: Finish** — controller runs `superpowers:finishing-a-development-branch` (merge to local main; push/release deferred to the user).

---

## Self-Review

**Spec coverage:** STUN Binding check (build/parse/check_stun) → Task 1; wired into `run()` → Task 1; tests (shape, roundtrip, garbage, dead-host) → Task 1; docs → Task 2. ✔
**Placeholder scan:** the test has an explicit typo-guard note pointing at the correct `struct.pack(">BBHI", ...)` form; BUILD-LOG count filled in after the run. No other gaps. ✔
**Type consistency:** `build_stun_binding_request() -> bytes`, `parse_xor_mapped_address(data) -> tuple|None`, `check_stun(host, port, timeout) -> (bool, str)` used identically in `smoke.py` and tests; `run()` keeps the existing `None`/bool/`False` label logic and adds one `check_stun` entry. `_STUN_MAGIC` is the single magic-cookie constant. ✔
