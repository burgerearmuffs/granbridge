# granbridge-broker — Multiplayer Backend (TOWER)

A contained `docker compose` stack for GRANBRIDGE internet multiplayer:

- **caddy** — automatic Let's Encrypt TLS; reverse-proxies `wss://` + `/turn` + `/healthz` to the broker.
- **broker** — stateless WebSocket rooms (password + presence + WebRTC signaling) and a single-port HTTP
  `/turn` (short-lived TURN credentials) + `/healthz`.
- **coturn** — `turn://` (3478) and `turns://` (5349, reusing Caddy's cert) for NAT/firewall traversal.
- **init** — one-shot; generates the shared TURN secret on first boot.

The broker is stateless (in-memory). Restart any time; clients rejoin automatically.

## Deploy (one-time)

1. **DNS:** point `DOMAIN` (e.g. `play.example.com`) at TOWER's public IP.
2. **Config:** `cp .env.example .env` and set `DOMAIN`. Set `TURN_EXTERNAL_IP` only if TOWER is behind a
   router. Leave `TURN_SECRET` unset to auto-generate.
3. **Firewall (open on TOWER):**
   - TCP **80, 443** (Caddy / `wss://` / `/turn`)
   - UDP+TCP **3478**, TCP **5349** (STUN/TURN / `turns://`)
   - UDP **49152–65535** (TURN relay range)
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
- **`wss://` room join** — WebSocket is reachable and a `join` handshake completes.
  Install `websockets` (`pip install websockets`) to enable the WS check; without it the check
  is skipped and the tool still reports the HTTP results.

Output ends with `RESULT: OK` (exit 0) on success or `RESULT: FAILED` (exit 1) on any failure.

**Note:** actual TURN *relay* requires a real WebRTC peer — verify that manually in a browser
(see the WebRTC relay check above). The smoke tool confirms the broker, TLS, and credential
endpoint; relay traversal itself is out of scope.

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

## Client

Build the app with `VITE_BROKER_URL=wss://$DOMAIN`. The client fetches TURN credentials from
`https://$DOMAIN/turn` at join and falls back to STUN-only if it is unreachable. Manual override:
the in-app broker URL field (persisted to `localStorage`).

## Scaling (far off)

Single-process, in-memory — ample for current scale. If ever needed, add Redis pub/sub to fan messages
across broker instances behind a load balancer.
