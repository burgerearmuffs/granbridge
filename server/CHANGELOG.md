# server CHANGELOG

Server releases use the `server-vX.Y.Z` tag convention and ship a single asset zip
(`granbridge-broker-server-vX.Y.Z.zip`), separately from the desktop app's `v0.x.x` releases.

---

## server-v0.2.0

**Breaking (transport):** the broker stack now runs over **TCP 80 + 443 only**. coturn is reached via
Caddy's ALPN demux on 443 (TURNS/TCP), TURN is **relay-only**, and UDP 3478 / TCP 5349 / the UDP relay
range are no longer used. `/turn` advertises a single `turns:DOMAIN:443?transport=tcp` server. Clients
from v0.1.x (which expect UDP TURN) must be rebuilt from this version. New env: `TURN_PUBLIC_PORT`,
`TURN_TRANSPORT`, `TURN_PUBLIC_HOST`.

### Changes

- **Caddy ALPN demux on 443** — a custom Caddy image (`Dockerfile.caddy`) bundles `caddy-l4`; the
  Caddyfile uses a `layer4` block to peek the TLS ClientHello ALPN and route web traffic (h2 /
  http/1.1 / acme-tls/1) to Caddy's own HTTPS handler and everything else (TURNS) directly to
  coturn's internal TLS port. Caddy's own HTTPS handler moves to `:8443`; real client IP is
  preserved via PROXY protocol.

- **coturn on the Docker bridge network** — coturn no longer uses `network_mode: host` and exposes
  no host ports. Caddy reaches it at `coturn:5349` on the internal `backend` network. Only TCP 80
  and TCP 443 need to be open on TOWER.

- **Relay-only TURN** — the broker's `/turn` endpoint now emits a single
  `turns:DOMAIN:443?transport=tcp` URI (was three `turn:` / `turns:` / `stun:` URIs). The matching
  client change forces `iceTransportPolicy:"relay"` so both peers relay through coturn; coturn
  routes media between the two TLS/443 connections internally.

- **New env knobs** (all optional; defaults implement the 443-only mode):
  - `TURN_PUBLIC_PORT` — client-facing port for the `turns://` URI (default `443`).
  - `TURN_TRANSPORT` — client-facing transport for the `turns://` URI (default `tcp`).
  - `TURN_PUBLIC_HOST` — override the hostname in the `turns://` URI (default: `DOMAIN`).

- **`smoke.py` update** — TURNS-over-TCP-443 Allocate is now the primary relay check. UDP 3478
  checks are demoted to `--legacy-udp` (skipped by default).

- **SWAG variant documented** — `server/docs/swag-port443.md` describes how to front the stack
  behind an existing nginx SWAG instance using `stream {}` / `ssl_preread` ALPN demux.

### Upgrade from server-v0.1.x

1. Rebuild the desktop client from this branch (needed for the `iceTransportPolicy:"relay"` and
   relay-only TURN URI changes — v0.1.x clients will not connect to the new coturn path).
2. Open only TCP 80 and TCP 443 on TOWER's firewall. Close UDP 3478, TCP 5349, and the UDP relay
   range (49152–65535) if they were open.
3. `docker compose up -d --build` to rebuild the custom Caddy image and restart the stack.
4. Verify with `python smoke.py wss://$DOMAIN` — all checks including `turns relay (TCP 443)` should
   pass; udp checks will show `SKIP`.

---

## server-v0.1.1

Per-IP rate limiting (`/turn` / WS-connect 429 + message-flood drop via `X-Real-IP`; env
`TURN_RATE_PER_MIN` / `CONN_RATE_PER_MIN` / `MSG_RATE_PER_SEC`), coturn relay quotas
(`TURN_TOTAL_QUOTA` / `TURN_MAX_BPS`), ACME-email injection, and `server/smoke.py` (one-command
deployment validator: `/healthz`, `/turn`, STUN UDP 3478, authenticated TURN relay Allocate,
`wss://` join). 47 server tests including a docker-gated real-coturn integration test.

---

## server-v0.1.0

Initial release. Dockerized `docker compose` stack: Caddy (auto Let's Encrypt) + stateless
WebSocket broker (rooms / password / presence / WebRTC signaling / `/turn` credentials /
`/healthz`) + coturn (`turn://` 3478 and `turns://` 5349, RFC 1918 SSRF-hardened, auto
cert-reload) + one-shot `init` (generates TURN secret on first boot). Single required env var:
`DOMAIN`. Asset zip: `granbridge-broker-server-v0.1.0.zip`.
