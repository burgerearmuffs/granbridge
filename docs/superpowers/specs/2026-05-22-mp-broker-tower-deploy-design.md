# GRANBRIDGE — Broker + coturn for real TOWER deployment (Design)

- **Date:** 2026-05-22
- **Status:** Approved (brainstorm gate passed). Autonomous mandate applies; gates self-approved per
  the user's standing pre-approval, but the two pivotal infra facts below were confirmed live.
- **Topic:** Productionize the multiplayer backend (`server/`) for a *real* public deployment on the
  user's Proxmox host "TOWER", and wire the client to use it end-to-end.
- **Supersedes nothing.** Builds on MP-1 (`41fc7ad`) and the locked decisions in
  `2026-05-22-multiplayer-architecture.md`.

## Context

MP-1 delivered a LAN-grade broker: `BrokerServer` (rooms + sha256 passwords + presence + WebRTC
signal relay + msg broadcast), in-memory/stateless, 4 tests, plus a `Dockerfile`, a `coturn`
`docker-compose.yml`, and a deploy `README`. Everything was kept local — never deployed.

This slice makes it actually deployable and actually usable remotely. Gaps it closes:

1. **TLS.** Remote WebRTC requires a secure context: browsers block `getUserMedia` and mixed `ws://`
   content off `localhost`. Clients need `wss://` to the broker and ideally `turns://` for TURN.
   The current compose is plaintext only.
2. **TURN credential delivery (the functional keystone).** coturn is configured with
   `--use-auth-secret` (time-limited HMAC creds), but nothing mints those creds for clients — the
   client's `peerManager.ts` has only a STUN entry and a commented-out TURN slot. TURN cannot work yet.
3. **coturn NAT/external-IP correctness.** `DETECT_EXTERNAL_IP: "yes"` is not a real coturn knob; a
   host behind a router needs `--external-ip`. Latent "TURN silently never relays" bug.
4. **Broker abuse-hardening** for a public port: no frame-size cap, no room-count cap, no structured
   logging, no graceful SIGTERM, no health endpoint.
5. **Reproducibility:** `coturn/coturn:latest`, unpinned `websockets`, obsolete compose `version:` key.

## Confirmed decisions (this slice)

- **TLS via bundled Caddy** (user confirmed they have/will point a DNS name at TOWER). Caddy is a third
  compose service doing automatic Let's Encrypt. It terminates `wss://` for the broker and its
  Let's Encrypt cert is reused by coturn for `turns://`.
- **Full end-to-end** (user confirmed): also wire the client to fetch TURN creds, populate
  `iceServers`, and default the broker URL to the TOWER hostname.
- **Approach A — "Full premium" TURN:** coturn offers `turns://` on 5349 (Caddy's cert) **and** plain
  `turn://` on 3478. (Approach B = `turn://`-only was the documented fallback; not chosen.)
- **"TURN agent" = the coturn service/sidecar** (not a separate process manager).
- **Turnkey + low-maintenance (user priority):** one-command deploy, ~one config variable, and **no
  recurring manual tasks** (see Operability). `TURN_SECRET` auto-generates and persists on first run;
  coturn reloads renewed certs automatically.
- **Profiles & stats stay client-local (confirmed):** the broker remains stateless; this slice adds no
  server-side datastore. Voice/video, profiles, avatars, and per-player stats all work per-device;
  cross-device/server-side profiles+stats are a deliberate future slice (out of scope).

## Architecture & file layout

The broker is split into small, single-purpose, independently testable units rather than growing the
one file. New files marked `NEW`.

```
server/
  granbridge_broker/
    broker.py      # WS room logic (existing; hardened: frame cap, room-count cap, logging, graceful stop)
    turn.py        # NEW  pure: mint coturn HMAC credentials (no I/O)
    http.py        # NEW  pure-ish: route GET /healthz + /turn; other paths -> None (WS upgrade)
    config.py      # NEW  parse env once into a frozen dataclass
    __main__.py    # wiring: build server with the http handler + SIGTERM/SIGINT graceful shutdown
  coturn/
    entrypoint.sh  # NEW  locate Caddy's cert (poll on first boot), exec coturn with hardening flags
  Caddyfile        # NEW  {$DOMAIN} { reverse_proxy broker:8788 }
  docker-compose.yml  # rewritten: caddy + broker + coturn; broker has NO host port
  .env.example     # NEW  DOMAIN, ACME_EMAIL?, TURN_SECRET, TURN_REALM?, TURN_TTL?, TURN_EXTERNAL_IP?
  Dockerfile       # pinned base, non-root user, HEALTHCHECK
  requirements.txt # pinned websockets

ui/src/multiplayer/
  turn.ts          # NEW  fetchIceServers(brokerWsUrl) -> RTCIceServer[] (STUN-only fallback)
  turn.test.ts     # NEW
  (Multiplayer view + peerManager wiring updated to fetch creds at join)
```

### Single-port WS + HTTP

The `websockets` server handles WS and plain HTTP on one port via a `process_request` hook: it returns
an HTTP `Response` for `/healthz` and `/turn`, or `None` to let the connection upgrade to WebSocket.
No second web framework, no second port — Caddy fronts everything behind one origin
(`wss://<domain>` for play, `https://<domain>/turn` for creds). The exact `process_request`
signature is pinned to the installed `websockets` version at implementation time; routing logic lives
in a pure function `route(path, headers) -> Response|None` so it is unit-testable without a socket.

## Network / data flow & ports

```
Client ──443 TLS──▶ Caddy ──(internal docker bridge)──▶ broker:8788   wss:// play · GET /turn · /healthz
Client ──3478 udp/tcp───────▶ coturn (turn://)        [host networking]
Client ──5349 tcp TLS───────▶ coturn (turns://, Caddy's cert)
relay  ──49152–65535 udp────▶ coturn
```

- **Caddy** publishes host ports **80** (ACME challenge + redirect) and **443** (TLS). Resolves
  `broker` by service name on a shared user-defined bridge network.
- **broker** is on the bridge network only — **no host port published** (smaller public surface).
- **coturn** uses **host networking** (needs the relay port range + 3478 + 5349 directly on the host)
  and mounts the Caddy cert volume read-only.
- **Host firewall opens:** 80/tcp, 443/tcp, 3478 udp+tcp, 5349/tcp, 49152–65535/udp.

All configuration flows from one `.env` — in practice **only `DOMAIN` is required**:

| Var | Required | Meaning |
|-----|----------|---------|
| `DOMAIN` | yes | Public hostname pointed at TOWER (Caddy cert subject + coturn realm + TURN uris) |
| `TURN_SECRET` | no | Shared HMAC secret (broker mints, coturn verifies). **Auto-generated + persisted to a volume on first run if unset**; set it only to pin a known value. |
| `ACME_EMAIL` | no | Let's Encrypt account email (recommended) |
| `TURN_REALM` | no | Defaults to `DOMAIN` |
| `TURN_TTL` | no | Credential lifetime seconds; default 86400 |
| `TURN_EXTERNAL_IP` | no | Set to `PUBLIC/PRIVATE` only if TOWER is behind a router (coturn `--external-ip`) |

## coturn configuration & hardening

Started by `entrypoint.sh`, which on boot polls (up to ~60 s) for Caddy's issued cert under the mounted
`caddy_data` volume (glob for `<DOMAIN>.crt`/`.key`, robust to the ACME-CA subdir name), copies them to
a coturn-readable path, then launches coturn. If the cert is still absent after the wait, coturn starts
**`turn://`-only** with a clear warning log (graceful degradation to Approach-B behavior); the same
background watcher below will SIGHUP coturn to enable `turns://` as soon as the cert appears — still
zero-touch.

Flags:
```
-n --log-file=stdout --no-cli --fingerprint
--lt-cred-mech --use-auth-secret --static-auth-secret=$TURN_SECRET
--realm=$TURN_REALM
--listening-port=3478
--tls-listening-port=5349 --cert=<copied>.crt --pkey=<copied>.key   # omitted in turn://-only fallback
--min-port=49152 --max-port=65535
[--external-ip=$TURN_EXTERNAL_IP]                                    # only if set
# Abuse defense (public relay = SSRF risk into the LAN on a Proxmox box):
--no-loopback-peers --no-multicast-peers
--denied-peer-ip=10.0.0.0-10.255.255.255
--denied-peer-ip=172.16.0.0-172.31.255.255
--denied-peer-ip=192.168.0.0-192.168.255.255
--denied-peer-ip=169.254.0.0-169.254.255.255
--denied-peer-ip=127.0.0.0-127.255.255.255
```

**Cert rotation (automated, zero-touch):** after launching coturn, the entrypoint runs a lightweight
background watcher on the mounted Caddy cert (mtime poll). When Caddy auto-renews (~every 60 days), the
watcher re-copies the cert and sends coturn **SIGHUP**, which reloads TLS without a restart or dropped
relays — no human action, ever. (SIGHUP cert-reload is verified at implementation; documented fallback
is an automatic `coturn` container restart on cert change.)

## Broker hardening (surgical)

- **Frame-size cap** via `serve(..., max_size=65536)` (signaling/msgs are tiny).
- **Room-count cap** (`MAX_ROOMS`, default e.g. 200) alongside the existing per-room cap (4); over-cap
  `join` of a *new* room → `error{code:"server_full"}`.
- **Structured stdout logging** (`logging`): connect/disconnect, join/leave, room create/reap, errors,
  with peer/room ids. Docker captures stdout.
- **Graceful shutdown:** install SIGTERM/SIGINT handlers that stop the server cleanly so `docker stop`
  does not wait 10 s for SIGKILL.
- **Optional Origin allowlist** (`ALLOWED_ORIGINS`, comma-separated). Default permissive (Tauri/native
  clients send a null/file origin); rooms remain password-gated regardless. Pure `origin_allowed()`.
- **`/healthz`** → `200 {"status":"ok","rooms":N,"peers":M}`, powering the Docker `HEALTHCHECK`.

The existing protocol and the 4 existing tests are unchanged in behavior.

## TURN credential endpoint

`GET /turn` → JSON shaped for easy client mapping:
```json
{
  "username": "1779494400",
  "credential": "<base64 HMAC-SHA1>",
  "ttl": 86400,
  "uris": [
    "turn:<DOMAIN>:3478?transport=udp",
    "turn:<DOMAIN>:3478?transport=tcp",
    "turns:<DOMAIN>:5349?transport=tcp"
  ]
}
```
- `username = str(int(now) + ttl)`; `credential = base64(HMAC_SHA1(TURN_SECRET, username))` — coturn's
  REST-API contract for `--use-auth-secret`.
- **Unauthenticated by design:** it mints only short-lived creds (same model as Twilio NTS). Abuse is
  bounded by the short TTL, the relay port range, and `--denied-peer-ip`. Optional per-IP throttling
  (broker-side or via Caddy) is noted as a future hardening, not built now.
- Implemented as a pure `make_turn_credentials(secret, ttl, now, domain) -> dict`.

## Client wiring (`ui/`)

- `ui/src/multiplayer/turn.ts` — `async fetchIceServers(brokerWsUrl): Promise<RTCIceServer[]>`:
  derive the https base (`wss://`→`https://`, `ws://`→`http://`), `GET /turn`, return
  `[{urls:"stun:stun.l.google.com:19302"}, {urls: data.uris, username, credential}]`. On **any**
  failure (network, non-200, malformed) → return STUN-only `DEFAULT_ICE_SERVERS` so play degrades
  gracefully instead of breaking.
- The `Multiplayer` view fetches ice servers at join and passes them into `PeerManager` (which already
  accepts an `iceServers` constructor arg — no PeerManager refactor needed).
- **Broker URL default** via build-time `VITE_BROKER_URL`: dev keeps `ws://127.0.0.1:8788`; the user
  bakes `wss://<domain>` when building the installer. No personal domain hardcoded in the repo. The
  existing localStorage override (`granbridge.mp.brokerUrl`) still wins for manual override.

## Testing strategy

Preserves the architecture's "fully testable locally" property; real A/V + TLS traversal are
manual-verify (need the real host).

- **`turn.py`** (pure): fixed `secret`+`now` → known `username`/`credential`; ttl honored; uris built
  from domain.
- **`http.py`** (pure `route`): `/healthz` returns 200 + JSON with live counts; `/turn` returns the
  cred JSON; unknown path returns `None` (→ WS upgrade path).
- **broker:** existing 4 tests stay green; add room-count-cap rejection (`server_full`) and
  `origin_allowed()` unit tests.
- **client `turn.ts`:** success merges the TURN server; failure → STUN-only fallback; `ws→http` /
  `wss→https` derivation. Existing 217 UI tests + the Python suites stay green; `npm --prefix ui run
  build` clean.
- **Manual-verify (runbook):** Caddy issues a cert; `wss://<domain>` connects; `https://<domain>/turn`
  returns creds; a forced-relay (`iceTransportPolicy:"relay"`) call connects through coturn; cert-reload
  via `docker compose restart coturn`.

## Operability & maintenance (user priority: low-touch)

Designed so deployment is one command and there are **no recurring manual tasks**:

- **One required variable.** Only `DOMAIN` must be set. `ACME_EMAIL` is recommended; everything else has
  a sane default.
- **Self-generating secret.** If `TURN_SECRET` is unset, it is generated once on first boot (a one-shot
  `init` step, run as root for deterministic volume permissions) and persisted to a shared `secrets`
  volume that both the broker and coturn read. Clients never receive it — only short-lived derived creds.
- **Zero-touch TLS.** Caddy auto-renews; a background watcher in the coturn container detects the
  renewed cert and SIGHUPs coturn to reload it live (no restart, no dropped relays).
- **Self-healing.** `restart: unless-stopped` + a broker `HEALTHCHECK` bring the stack back after
  crashes or host reboots.
- **Contained.** One `docker compose` stack (Caddy + broker + coturn); no external services/accounts
  beyond the DNS name. (Three services, not one image: coturn requires host networking.)

## Deploy / what needs the user (one-time)

1. Point `DOMAIN` at TOWER's public IP (A record or dynamic-DNS).
2. `cp .env.example .env`; set `DOMAIN` (optionally `ACME_EMAIL`; set `TURN_EXTERNAL_IP` only if TOWER is
   behind a router). Leave `TURN_SECRET` unset to auto-generate.
3. Open the firewall ports listed above.
4. `docker compose up -d --build`; verify with the runbook checks.
5. Build the app once with `VITE_BROKER_URL=wss://<domain>`.

**Recurring maintenance: none** (see Operability). The updated `server/README.md` carries the full
runbook, replacing the LAN-only instructions.

## Out of scope (flagged)

- Multi-instance / Redis fan-out scaling (single process is ample for current scale).
- Server-side profiles **and stats** (cross-device identity, shared leaderboard) — confirmed local-only
  for this slice; a deliberate future slice (it would add the only stateful/maintenance piece).
- `turns://` on **443** via SNI/layer-4 routing (Approach C) — only matters on the most hostile
  firewalls; revisit if a real user hits it.
- Metrics/Prometheus endpoint; per-IP rate limiting (noted as future hardening).

## Success criteria

1. `docker compose up -d --build` on a host with `DOMAIN` set brings up caddy + broker + coturn;
   `healthcheck` reports the broker healthy.
2. `https://<domain>/healthz` returns ok; `https://<domain>/turn` returns valid time-limited creds;
   `wss://<domain>` accepts a broker WS connection.
3. coturn authenticates those creds and relays (verified by a forced-relay WebRTC connection).
4. The client, built with `VITE_BROKER_URL=wss://<domain>`, fetches creds and includes the TURN server
   in its `iceServers`, with graceful STUN-only fallback if `/turn` is unreachable.
5. All existing suites stay green; new units (`turn`, `http` routing, room cap, origin, client
   `turn.ts`) are covered. Real TLS/TURN traversal is documented as manual-verify.
6. Repro: pinned `websockets` + pinned `coturn` image; no obsolete compose keys; broker container runs
   non-root.
7. Turnkey: only `DOMAIN` is required to deploy; `TURN_SECRET` auto-generates; TLS renews and reloads
   with no manual step; the stack self-heals across reboots.
