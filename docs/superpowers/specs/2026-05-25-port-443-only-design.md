# GRANBRIDGE — Broker stack over port 443 only (Design)

- **Date:** 2026-05-25
- **Status:** Approved (brainstorm gate passed).
- **Topic:** Collapse the multiplayer backend (`server/`) so that a TOWER (or any) deployment needs to
  open **only TCP 80 + 443** on its firewall/router — no UDP 3478, no TCP 5349, no UDP relay range.
- **Builds on** `2026-05-22-mp-broker-tower-deploy-design.md` (bundled Caddy + coturn) and
  `2026-05-23-server-hardening` (rate limits, smoke validator). Targets a **`server-v0.2.0`** release
  (breaking transport change → minor bump).

## Context / motivation

The deployed stack currently requires five distinct firewall openings on TOWER:

- TCP **80, 443** — Caddy / `wss://` / `/turn`
- UDP+TCP **3478** — STUN / `turn://`
- TCP **5349** — `turns://`
- UDP **49152–65535** — TURN relay range

The user's hard requirement for this version: **everything works over 443 so no extra ports must be
opened.** This is the classic "TURN over TLS on 443, relay-only" configuration used in locked-down
networks, plus a TLS demultiplexer so the web broker (WSS) and coturn (TURNS) can share one 443
listener.

## Confirmed decisions (brainstorm)

1. **Both / configurable.** The bundled `docker compose` stack is fully self-contained and
   port-minimal on 443; a **SWAG-fronted variant** is also documented for TOWER's existing nginx
   reverse proxy. The bundled stack is the *tested reference*; the SWAG snippet is user-validated.
2. **Force relay-only over 443.** Both clients relay through coturn over TURNS/TCP 443; coturn routes
   between the two TLS connections internally. All match A/V flows through TOWER (acceptable for the
   2-player home use case). This is the only configuration that needs *literally* one open port.
3. **Single hostname, ALPN-based demux.** No new DNS record. The 443 front-end peeks the TLS
   ClientHello ALPN: `h2` / `http/1.1` / `acme-tls/1` → web broker; anything else → coturn.
4. **Demux mechanism = `caddy-l4`.** Caddy stays the single front door (smallest delta from today,
   keeps ACME in one place). Built as a custom image via an `xcaddy` build stage.

## Architecture (bundled stack)

```
Internet                          TOWER host
  │  :443  (all TLS — web AND turn)        :80 (ACME HTTP-01 + redirect only)
  ▼
┌───────────────────────────────────────────────────────────┐
│ caddy  (custom image: caddy + caddy-l4)                     │
│  layer4 :443 ── peek ClientHello ALPN:                      │
│     h2 / http/1.1 / acme-tls/1  ─► 127.0.0.1:8443 (Caddy    │
│                                    HTTPS, terminates TLS,   │
│                                    reverse_proxy → broker)  │
│     (anything else)             ─► coturn:5349 (raw TLS     │
│                                    passthrough, coturn      │
│                                    terminates)              │
└───────────────┬───────────────────────────────┬────────────┘
                ▼ reverse_proxy (X-Real-IP)       ▼ tcp proxy (no TLS term)
        broker:8788 (WSS, /turn, /healthz)   coturn:5349 (TURNS, relay-only)
```

Only **80 + 443** are published on the host. coturn, broker, and Caddy's internal HTTPS handler are
all unreachable directly.

## Components & changes

### 1. Caddy → custom image + layer4 config
- **Dockerfile (new build stage or `Dockerfile.caddy`):**
  ```dockerfile
  FROM caddy:2.8-builder AS build
  RUN xcaddy build --with github.com/mholt/caddy-l4
  FROM caddy:2.8
  COPY --from=build /usr/bin/caddy /usr/bin/caddy
  ```
- **`docker-compose.yml` `caddy` service:** switch from `image: caddy:2.8` to `build:` the custom
  image. Keep `ports: ["80:80", "443:443"]`, the cert volumes, and the `init` dependency.
- **Caddy config** (Caddyfile with `layer4` global app, or JSON if Caddyfile support is insufficient):
  - `layer4` listens on `:443`. Matcher `@web tls alpn h2 http/1.1 acme-tls/1` → `proxy 127.0.0.1:8443`.
    Default route → `proxy coturn:5349`.
  - A standard Caddy site bound to `127.0.0.1:8443` terminates TLS for `$DOMAIN` and
    `reverse_proxy broker:8788` with `header_up X-Real-IP {remote_host}` (unchanged proxy semantics).
  - **ACME:** primary challenge = **HTTP-01 on :80** (already published). `acme-tls/1` is additionally
    routed to the web side so TLS-ALPN-01 renewal cannot be silently broken by the heuristic.
  - The `ACME_EMAIL` injection logic from the current entrypoint is preserved.

### 2. coturn → bridge network, internal TLS only
- **`coturn/entrypoint.sh`:** keep `--tls-listening-port=5349` (now internal), `--listening-port=3478`
  (internal, harmless), relay range, SSRF `--denied-peer-ip` hardening, quotas, `--external-ip`, and
  the cert-reuse + SIGHUP reload watcher **unchanged**. Single hostname ⇒ the reused `$DOMAIN` cert's
  SNI matches client connections.
- **`docker-compose.yml` `coturn` service:** **remove `network_mode: host`**; add `networks: [backend]`.
  Publish **no** host ports. Keep cert/secret volume mounts and `init` dependency.

### 3. Broker `/turn` response + config
- **`granbridge_broker/turn.py`:** `/turn` payload advertises a **single** ICE server:
  `turns:<TURN_PUBLIC_HOST>:<TURN_PUBLIC_PORT>?transport=<TURN_TRANSPORT>`, default
  `turns:$DOMAIN:443?transport=tcp`. Drop the `turn:…:3478` and `turns:…:5349` entries.
- **`granbridge_broker/config.py` + `.env.example`:** new knobs with 443-only defaults —
  `TURN_PUBLIC_PORT=443`, `TURN_TRANSPORT=tcp`, `TURN_PUBLIC_HOST=$DOMAIN`. HMAC credential minting
  (shared secret, TTL) is unchanged.

### 4. Client ICE policy (`ui/src/multiplayer/`)
- Set **`iceTransportPolicy: 'relay'`** on the `RTCPeerConnection` in `PeerManager` so each browser
  gathers only relay candidates → the only possible pair is relay↔relay → coturn routes internally.
- `iceServers` continues to come from the broker `/turn` response (no hardcoded URLs), so it picks up
  the single `turns:…:443?transport=tcp` entry automatically. Remove now-dead STUN-only fallback
  branches in favor of one clean relay path.
- **Matched pair:** the server `/turn` change and this client change must ship together (a client that
  omits relay-only would try the closed UDP range and fail). This work spans `server/` **and** `ui/`,
  and full E2E needs a rebuilt client.

### 5. SWAG-fronted variant (documented)
- TOWER keeps SWAG (nginx) owning 443. Provide an nginx **`stream {}`** snippet using
  **`ssl_preread`** to inspect `$ssl_preread_alpn_protocols` and route web ALPN → SWAG's internal
  HTTPS listener, else → the coturn container's `5349`. coturn runs from the same compose file with
  ports kept on a network SWAG can reach.
- Shipped as a README section / `server/docs/swag-port443.md` with the exact stream config + a compose
  override. Marked clearly: bundled caddy-l4 stack is the tested path; SWAG snippet is user-validated
  on TOWER (cannot be exercised from the dev box).

## Data flow (relay-only call)

1. Both clients fetch `/turn` over WSS/443 → receive `turns:$DOMAIN:443?transport=tcp` + HMAC creds.
2. Each opens a TLS connection to `:443`; ALPN is absent/non-HTTP → caddy-l4 routes raw to `coturn:5349`;
   coturn terminates TLS and authenticates the Allocate → returns a relay address.
3. `iceTransportPolicy:'relay'` ⇒ each client offers only its relay candidate. ICE pairs them
   relay↔relay.
4. Media A→B: A sends ChannelData over its TLS/443 connection to coturn; coturn recognizes the
   destination as B's allocation and writes it out over B's TLS/443 connection. The UDP relay socket
   never sees public traffic.

## Testing

- **`smoke.py`:**
  - **Add** TURNS-over-TCP-443 Allocate check (TLS to `$DOMAIN:443`, authenticated Allocate, expect a
    relay address) — the primary proof the 443 path works.
  - **Add** ALPN-demux check (handshake with `h2` reaches `/healthz`=`ok`; handshake with no/unknown
    ALPN reaches coturn / not HTTP).
  - **Demote** UDP-3478 STUN + UDP-3478 relay checks to opt-in (`--legacy-udp`); default prints
    "skipped (443-only mode)" instead of failing.
  - Keep `/healthz`, `/turn`-payload, `wss://` join checks.
- **Unit:** `test_turn.py` / `test_config.py` assert the single `turns:…:443?transport=tcp` URI and the
  new env knobs.
- **Integration (docker-gated):** extend `test_turn_relay_integration.py` (or a sibling) to bring up
  the real caddy-l4 + coturn stack and assert (a) a relay Allocate succeeds **through 443** and (b)
  ALPN routing splits web vs. turn. This is where the relay↔relay-internal assumption is empirically
  confirmed.
- **Manual:** two real browsers / two portable clients, both behind NAT, complete a match with media —
  the only way to fully confirm relay↔relay over 443.

## Risks / things to verify during implementation

- **coturn same-server relay↔relay over TURN-TLS/TCP** works without RFC-6062 TCP *relay* allocations.
  High confidence (standard coturn behavior; how corporate TURN-443 works), but explicitly confirmed by
  the docker integration test + two-browser check rather than asserted.
- **caddy-l4 Caddyfile support** for `tls`/`alpn` matchers may be incomplete on 2.8; fall back to JSON
  config if so.
- **ACME under ALPN demux** — verify HTTP-01 succeeds with Caddy's HTTPS handler on an internal port;
  keep `acme-tls/1` routed to web as belt-and-suspenders.
- **Docs accuracy** — `README.md` firewall section rewritten to "Open only TCP 80 + 443."

## Out of scope

- Direct P2P / STUN srflx path and any `iceTransportPolicy` toggle (explicitly rejected in favor of
  forced relay-only).
- A dedicated `turn.` subdomain / SNI demux (rejected in favor of single-hostname ALPN).
- Changes to game-sync, stats, or auth.
```
