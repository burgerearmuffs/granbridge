# GRANBRIDGE — Server Hardening v2 (Design)

- **Date:** 2026-05-23
- **Status:** Self-approved under the autonomous mandate (user is rolling `server-v0.1.0` to live hardware in parallel; design decisions documented here, all env-configurable to tune later).
- **Builds on:** `server-v0.1.0` (Caddy + broker + coturn). Closes the public-endpoint hardening gaps identified after that slice.
- **Branch:** `server-hardening`.

## Context

The broker port is public. Today the only abuse bounds are: a 64 KiB WS frame cap, a `max_rooms` cap, and coturn's RFC1918 `--denied-peer-ip` (no LAN SSRF). Missing: any **rate limiting** (the `/turn` endpoint is unauthenticated *and* unthrottled; WS connect/room-creation is open up to the room cap; per-connection message flood is unbounded), **coturn relay quotas** (a harvested credential could burn unlimited relay bandwidth/sessions), and **ACME email** wiring (no cert-renewal-failure notifications).

## Decisions

### 1. Rate limiting — in the broker (Python, zero deps)
Implemented in-process, not in Caddy (a Caddy rate-limit module needs a custom image — rejected to keep the stack contained/low-maintenance).

- **Client IP source:** read `X-Real-IP`, which Caddy sets authoritatively via `header_up X-Real-IP {remote_host}` (the real TCP peer as Caddy sees it — spoof-proof because `header_up` overwrites any client-supplied value). Fallback to `connection.remote_address` host if the header is absent (direct/no-proxy access). Behind the docker bridge, `connection.remote_address` is Caddy's IP, so the header is required for per-client limiting.
- **`/turn` (HTTP):** per-IP sliding window, default **30/min** (`TURN_RATE_PER_MIN`). Over-limit → HTTP **429**.
- **WS upgrades:** per-IP, default **60/min** (`CONN_RATE_PER_MIN`). Over-limit → **429** returned from `process_request` (rejects before the upgrade).
- **Per-connection message flood** (`signal` + `msg`): default **20/sec** (`MSG_RATE_PER_SEC`). Over-limit → **drop** the message + log a warning (no force-close, so a legitimate burst isn't punished). `join`/`leave` are not flood-limited (one-shot).
- **Implementation:** a pure `RateLimiter` (fixed-window or sliding-window counter keyed by string) with an injectable clock, unit-tested; idle keys pruned opportunistically so the per-IP map can't grow unbounded. Limits come from `config.from_env` (new fields), passed into `BrokerServer` as keyword args (backward-compatible, like the existing caps). `0` disables a given limit.

### 2. coturn relay quotas
Bound the "harvest a credential, abuse the relay" risk:
- `--total-quota` — max simultaneous allocations server-wide (`TURN_TOTAL_QUOTA`, default **200**).
- `--max-bps` — per-allocation bandwidth cap in bytes/sec (`TURN_MAX_BPS`, default **0** = unlimited; documented so the operator sets a value matched to their uplink — e.g. ~500000 ≈ 4 Mbps headroom for HD video).
- `--user-quota` is **omitted**: the REST username is the expiry timestamp, shared by all clients fetching creds in the same window, so a per-user quota would throttle everyone collectively. Documented as a known limitation. `--total-quota` is the meaningful global bound.

### 3. ACME email wired
`ACME_EMAIL` → compose `caddy` env → Caddyfile global options `email` block, so Let's Encrypt sends expiry/renewal-failure notices. The empty-vs-set behavior is **validated against the real `caddy:2.8` image** during implementation (Caddy errors on a bare `email` directive, so the exact form — env-default placeholder vs. omission when empty — is chosen empirically). Added to `.env.example` (recommended, not required).

### 4. Origin allowlist — document, don't change the default
`ALLOWED_ORIGINS` already exists and defaults to permissive because the Tauri/native client sends a null origin (a strict allowlist would break it). No code change; the README documents enabling it for browser-only deployments.

## Architecture / files

```
server/granbridge_broker/
  ratelimit.py   # NEW  pure RateLimiter (windowed counter) + client_ip(request, conn) helper
  config.py      # +rate-limit fields in from_env / BrokerConfig
  broker.py      # consult limiters in _process_request (/turn 429, WS-upgrade 429) and in the
                 #   signal/msg handlers (drop over-limit); ctor gains rate-limit kwargs
  __main__.py    # pass the new config fields into BrokerServer
server/
  Caddyfile      # + header_up X-Real-IP {remote_host}; + ACME email global block
  docker-compose.yml  # caddy: ACME_EMAIL; broker: rate-limit env; coturn: quota env
  coturn/entrypoint.sh # + --total-quota + --max-bps (from env)
  .env.example   # + ACME_EMAIL, TURN_RATE_PER_MIN, CONN_RATE_PER_MIN, MSG_RATE_PER_SEC,
                 #   TURN_TOTAL_QUOTA, TURN_MAX_BPS
  README.md      # hardening section: rate limits, coturn quotas, ALLOWED_ORIGINS guidance
```

## Testing
- `ratelimit.py`: pure unit tests (allows under limit; blocks at/over limit; window resets with injected clock; distinct keys independent; `0` disables; idle-key pruning). `client_ip`: X-Real-IP wins, falls back to remote_address, handles missing.
- broker: `_http_route("/turn", client_ip=...)` returns 429 after the limit; WS-upgrade rejection over the connect limit (rapid connects from one IP with a low test limit); message-flood drop (send > limit on one connection, peer receives ≤ limit). Existing 16 stay green (limits default high / disabled in their fixtures).
- Caddy / coturn: in-image validation (`caddy validate`, `sh -n`), real traversal manual-verify on TOWER.

## Out of scope
Per-user TURN quota (needs unique usernames + a turn.py/test change). Distributed/multi-instance rate limiting. fail2ban/WAF. CAPTCHA/auth on `/turn`.

## Success criteria
1. Over-limit `/turn` returns 429; over-limit WS connects are rejected; message floods are dropped — all per-IP via `X-Real-IP`, all env-tunable, `0` disables.
2. coturn enforces `--total-quota` and (if set) `--max-bps`.
3. `ACME_EMAIL` flows to Caddy and `caddy validate` passes with it set and unset.
4. Existing broker suite stays green; new units (ratelimit, client_ip, 429 paths) covered. Real traversal documented manual-verify.
