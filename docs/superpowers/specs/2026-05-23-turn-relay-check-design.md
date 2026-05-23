# Smoke Tool — TURN Relay Auto-Check (Design)

- **Date:** 2026-05-23 · Self-approved (autonomous mandate; user picked this from the offered options).
- **Builds on:** `server/smoke.py` (health/turn/STUN/ws checks). Adds an authenticated TURN **Allocate** so the operator can verify *actual relay* — coturn accepting the broker's minted credentials and allocating a relay address — **without a browser**. Closes the last manual-verify gap for the TURN half.
- **Branch:** `turn-relay-check`.

## Why
The STUN check proves coturn is *reachable* on UDP 3478; it does **not** prove coturn accepts our REST credentials or can allocate a relay. The only other way to confirm that has been a real WebRTC browser session. A CLI TURN Allocate closes that gap.

## Protocol (RFC 5766 Allocate + RFC 5389 long-term auth)
coturn runs `--use-auth-secret` (REST API): the `/turn` `username` is a timestamp and `credential` is `base64(HMAC-SHA1(secret, username))`. The long-term-credential auth uses those as username/password. Flow:

1. **Initial Allocate** (no auth) → coturn replies **401** (`Allocate Error 0x0113`) carrying `REALM` (0x0014) and `NONCE` (0x0015).
2. **Authed Allocate** with attributes, in order: `USERNAME` (0x0006), `REALM` (0x0014, echo), `NONCE` (0x0015, echo), `REQUESTED-TRANSPORT` (0x0019, value `\x11\x00\x00\x00` = UDP), then **`MESSAGE-INTEGRITY`** (0x0008) **last**.
   - **Key** = `MD5(f"{username}:{realm}:{credential}")` (16 bytes). (Username is a timestamp, credential is base64 — both ASCII, so SASLprep is a no-op.)
   - **MESSAGE-INTEGRITY gotcha:** the HMAC-SHA1 is computed over the message *up to but not including* the MI attribute, **but the header Message-Length must already include the 24-byte MI attribute** (4 header + 20 value). So: build header with `length = len(body) + 24`, `mi = HMAC-SHA1(key, header + body)`, then append `struct.pack(">HH", 0x0008, 20) + mi`.
3. coturn replies **Allocate Success** (`0x0103`) with `XOR-RELAYED-ADDRESS` (0x0016, XOR-encoded like XOR-MAPPED-ADDRESS) → success. A second **401** means the credentials were rejected.
4. **Politely release**: optionally send a Refresh with `LIFETIME=0` (best-effort; coturn also times the allocation out).

## Design
All additions go in `server/smoke.py` (keeps the validator a single self-contained file that ships in the release zip), reusing the existing STUN attribute machinery:

- Add an `attr_type=0x0020` parameter to `parse_xor_mapped_address` so it also decodes `XOR-RELAYED-ADDRESS` (0x0016) — one-line change, existing default + tests unaffected.
- `_get_attr(data, attr_type) -> bytes | None` — generic raw-value attribute extractor (for REALM/NONCE), reusing the same bounded attribute-walk + 4-byte padding logic.
- `_long_term_key(username, realm, credential) -> bytes` — MD5 of `username:realm:credential`.
- `_build_initial_allocate(txn) -> bytes` and `_build_authed_allocate(txn, username, realm_bytes, nonce_bytes, key) -> bytes` (the latter applies the length-includes-MI trick).
- `check_turn_relay(http_base, host, port=3478, timeout=5.0) -> (bool, str)` — fetch `/turn` creds, run the two-step Allocate, return `(True, "relay allocated <ip:port>")` / `(False, reason)`. Broad `except` → `(False, msg)` (never raises).
- Wire `check_turn_relay(base, host, 3478)` into `run()` after the STUN check.

## Testing
- **Pure unit tests** (no network): `_long_term_key` against a known MD5; `_build_authed_allocate` structure (USERNAME/REALM/NONCE/REQUESTED-TRANSPORT present, MI attr last, header length includes MI); `parse_xor_mapped_address(resp, 0x0016)` XOR-RELAYED-ADDRESS roundtrip; `_get_attr` extracts REALM/NONCE from a crafted 401; a MESSAGE-INTEGRITY self-consistency check.
- **Docker-gated real-coturn integration test (the correctness oracle):** start `coturn/coturn:4.6.2` with `--use-auth-secret --static-auth-secret=<test> --realm=<test> --no-tls --no-dtls --listening-port=3478` published on UDP 3478; mint matching creds with the **real** `granbridge_broker.turn.make_turn_credentials(secret, ...)`; call `check_turn_relay` and assert success + a relayed address. coturn validates the MESSAGE-INTEGRITY itself, so a passing Allocate proves the key derivation + MI length-trick + attribute encoding are all correct. `@pytest.mark.skipif` when `docker` is unavailable.

## Out of scope
- TURN over TCP/TLS (`turns://` 5349) Allocate — UDP is the meaningful relay path; TCP/TLS is a future add.
- Sending actual data over the allocated relay (CreatePermission/Send/Data) — a successful Allocate already proves creds + relay allocation.

## Success criteria
1. `check_turn_relay` against a real coturn (known secret) returns success + a relayed address, using creds minted by the broker's own `make_turn_credentials`.
2. Wrong/expired creds → clean `(False, ...)`, never an exception.
3. Wired into `run()`; `python smoke.py wss://<domain>` now reports a `turn relay` PASS/FAIL line.
4. Pure unit tests cover the primitives; the docker-gated test proves end-to-end correctness; existing 41 server tests stay green.
