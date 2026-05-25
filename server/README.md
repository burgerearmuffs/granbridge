# granbridge-broker — Multiplayer Backend (TOWER)

A contained `docker compose` stack for GRANBRIDGE internet multiplayer:

- **caddy** — automatic Let's Encrypt TLS; reverse-proxies `wss://` + `/turn` + `/healthz` to the broker.
- **broker** — stateless WebSocket rooms (password + presence + WebRTC signaling) and a single-port HTTP
  `/turn` (short-lived TURN credentials) + `/healthz`.
- **coturn** — `turns://` over TLS, reached only via Caddy's ALPN demux on 443 (no host ports). Relay-only.
- **init** — one-shot; generates the shared TURN secret on first boot.

The broker is stateless (in-memory). Restart any time; clients rejoin automatically.

## Deploy (one-time)

1. **DNS:** point `DOMAIN` (e.g. `play.example.com`) at TOWER's public IP.
2. **Config:** `cp .env.example .env` and set `DOMAIN`. Set `TURN_EXTERNAL_IP` only if TOWER is behind a
   router. Leave `TURN_SECRET` unset to auto-generate.
3. **Firewall (open on TOWER):**
   - TCP **80** — Let's Encrypt HTTP-01 challenge (cert issuance/renewal) + HTTP→HTTPS redirect.
   - TCP **443** — everything else: `wss://` play, `/turn`, `/healthz`, **and** `turns://` (ALPN-demuxed).

   That's it. UDP 3478, TCP 5349, and the UDP relay range (49152–65535) are **no longer needed** —
   coturn runs on the internal Docker network and all TURN traffic is tunneled over TLS on 443. Both
   clients relay (forced `iceTransportPolicy:"relay"`), so coturn routes media between the two TLS/443
   connections internally and never exposes a UDP relay port.
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

### Validate a deployment

After `docker compose up -d --build`, run the smoke tool from the `server/` directory:

```bash
python smoke.py wss://$DOMAIN
```

This confirms in one command that:

- **`/healthz`** — broker is up and returns `status: ok`.
- **`/turn`** — credential endpoint returns a well-formed payload (`username`, `credential`, `uris`).
- **TURNS-over-443 relay** (`turns relay` line) — opens a TLS connection to port 443 and performs an
  authenticated TURN Allocate using the broker's `/turn` credentials. A successful Allocate confirms
  that Caddy's ALPN demux routes non-HTTP TLS to coturn and that coturn accepts the broker's
  HMAC-minted credentials, verifying the full 443-only TURN flow end-to-end **without a browser**.
- **`wss://` room join** — WebSocket is reachable and a `join` handshake completes.
  Install `websockets` (`pip install websockets`) to enable the WS check; without it the check
  is skipped and the tool still reports the HTTP results.
- **UDP 3478 checks** — SKIPPED by default (443-only mode). Pass `--legacy-udp` to test a legacy
  UDP-3478 deployment.

Output ends with `RESULT: OK` (exit 0) on success or `RESULT: FAILED` (exit 1) on any failure.

**Note:** the smoke tool expects the **full stack** (broker **and** coturn). If you point it at a
broker-only target with no coturn, the TURNS relay check will FAIL — that is the correct and expected
result, not a bug. Full end-to-end WebRTC relay (ICE + media) still requires two real peers and a
browser (see the WebRTC relay check above).

## Maintenance: none

- Caddy auto-renews TLS; coturn's watcher reloads the renewed cert automatically (SIGHUP), or restarts
  to enable `turns://` if the cert appears after first boot.
- `restart: unless-stopped` + the broker `HEALTHCHECK` recover from crashes/reboots.

## Hardening

All limits are env-configurable; `0` disables the check. Defaults are shown.

### Per-IP rate limits (broker)

The broker reads `X-Real-IP` set authoritatively by Caddy, so the real client IP
is used even behind the reverse proxy.

| Env var | Default | What it limits |
|---|---|---|
| `TURN_RATE_PER_MIN` | `30` | `/turn` credential requests per IP per minute |
| `CONN_RATE_PER_MIN` | `60` | WebSocket upgrades per IP per minute |
| `MSG_RATE_PER_SEC` | `20` | `signal`/`msg` messages per connection per second |

Requests that exceed a limit receive HTTP 429; excess messages are silently dropped
(the sender stays connected).

### coturn relay quotas

| Env var | Default | What it limits |
|---|---|---|
| `TURN_TOTAL_QUOTA` | `200` | Maximum simultaneous relay allocations across all clients |
| `TURN_MAX_BPS` | `0` (disabled) | Per-allocation bytes/sec cap |

Set via `.env`; the entrypoint passes `--total-quota` and (when non-zero) `--max-bps`
to `turnserver`.

### ACME email

Set `ACME_EMAIL=you@example.com` in `.env` to receive Let's Encrypt renewal and
expiry notices. The `caddy` service injects the email global block at startup when
the variable is set; leave unset to suppress it.

### Origin allowlist

Set `ALLOWED_ORIGINS=https://play.example.com` (comma-separated) to restrict WebSocket
upgrades to browser origins you control. Leave **unset** for the native GRANBRIDGE app,
which sends a null origin and is deliberately excluded from origin enforcement.

## Stats

The broker stores per-player match stats in a SQLite database on the `data` named volume.

### Wire shapes

**Write (WebSocket `stats_submit` message):**
```json
{
  "type": "stats_submit",
  "id": "<player-public-uuid>",
  "writeToken": "<private-write-token>",
  "player": { "id": "<player-public-uuid>", "name": "Ann", "avatar": { "color": "#f00" } },
  "match": {
    "match_id": "<uuid>", "mode": "x01",
    "opponent_id": "<uuid-or-null>", "winner_id": "<uuid-or-null>",
    "is_remote": true, "darts": 9, "total_scored": 180,
    "started_at": "2026-05-24T10:00:00.000Z", "ended_at": "2026-05-24T10:05:00.000Z",
    "throws": [{ "bed": "T20", "score": 60, "ts": "2026-05-24T10:00:01.000Z" }]
  }
}
```
Response: `{"type": "stats_ack", "match_id": "<uuid>", "verified": false}` on success,
or `{"type": "error", "code": "...", "message": "..."}` on rejection
(`token_mismatch`, `implausible`, `unsupported`, `rate_limited`, `bad_request`).

**Read (HTTP GET):**
- `GET /stats/player/{id}` — returns `{id, display_name, avatar_color, games_played, wins,
  verified_games, darts, total_scored, three_dart_avg, heatmap}`.
- `GET /stats/leaderboard?metric=avg&limit=20` — returns `{metric, players:[...]}`. Only
  players with `verified_games >= 3` appear (both sides of a match must co-sign the same
  `match_id` with the same `winner_id`).

### Storage + TOFU auth

Stats live in SQLite on the `data` volume (`STATS_DB_PATH=/data/stats.db`), keyed by the
player's **public UUID**. Writes are authorized by a **private write-token** (trust-on-first-use:
the first writer for an id registers `sha256(token)`; later writes must match). Set
`STATS_DB_PATH` to an empty string in `.env` to disable stats entirely.

### Backup

Stats are in the `data` Docker named volume. To back up:

```bash
docker compose cp broker:/data/stats.db ./stats-backup.db
```

Or copy the named volume directly. No automated backup is configured.

### Tuning

| Env var | Default | What it limits |
|---|---|---|
| `STATS_RATE_PER_MIN` | `30` | Stats submit/read requests per IP per minute |

Set `STATS_DB_PATH=` (empty) in `.env` to disable stats entirely; the broker omits
`/stats/*` routes and replies `unsupported` to `stats_submit` WS messages.

## Client

Build the app with `VITE_BROKER_URL=wss://$DOMAIN`. The client fetches TURN credentials from
`https://$DOMAIN/turn` at join and uses relay-only ICE (`iceTransportPolicy:"relay"`); it returns
`[]` on failure (no STUN fallback, since STUN is useless under relay-only). Manual override:
the in-app broker URL field (persisted to `localStorage`).

## Scaling (far off)

Single-process, in-memory — ample for current scale. If ever needed, add Redis pub/sub to fan messages
across broker instances behind a load balancer.
