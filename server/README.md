# granbridge-broker — Multiplayer Broker Server

A thin WebSocket broker for GRANBRIDGE multiplayer: rooms, password protection, presence broadcasts, and WebRTC signaling relay. Pairs with a coturn TURN server for peer-to-peer media when NAT traversal is needed.

The broker is **stateless** (in-memory only, no database). It can be restarted at any time; clients rejoin automatically.

---

## Quick Deploy on TOWER

### Prerequisites

- Docker + Docker Compose installed on TOWER
- A public IP (or DNS name) reachable from clients
- Firewall open on: **TCP 8788** (broker), **UDP/TCP 3478** (STUN/TURN), **UDP 49152-65535** (TURN relay range)

### 1. Clone / copy the `server/` directory onto TOWER

```
scp -r server/ user@tower:/opt/granbridge-broker/
```

### 2. Set required environment variables

Create `/opt/granbridge-broker/.env`:

```
TURN_SECRET=<long random secret>
TURN_REALM=granbridge.yourdomain.com
```

Generate a secret: `openssl rand -hex 32`

### 3. Start both services

```bash
cd /opt/granbridge-broker
docker compose up -d --build
```

Check logs:

```bash
docker compose logs -f
```

### 4. Verify the broker is up

```bash
# Should return a 101 Switching Protocols (connection upgrade)
curl -i --include --no-buffer \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Host: tower.example.com:8788" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  http://tower.example.com:8788/
```

---

## TLS / wss:// (Recommended for Production)

The broker speaks plain WebSocket (`ws://`). For encrypted connections:

1. Put a reverse proxy (Caddy or nginx) in front on port 443:

   **Caddy** (`Caddyfile`):
   ```
   broker.yourdomain.com {
       reverse_proxy localhost:8788
   }
   ```
   Caddy obtains a Let's Encrypt cert automatically.

2. Clients then connect to `wss://broker.yourdomain.com`.

---

## TURN / coturn Configuration

The `coturn` service in `docker-compose.yml` uses **time-limited HMAC credentials** (`--use-auth-secret`). Clients generate temporary credentials from `TURN_SECRET` and the current Unix time. The GRANBRIDGE app does this automatically when given the TURN secret or a credential-generation endpoint.

For full TLS TURN support (`turns://`), mount certificates into the container and add `--tls-listening-port=5349 --cert=... --pkey=...` flags to the command.

---

## Client Configuration

In the GRANBRIDGE app, set the broker URL:

```
broker_url = "ws://tower.example.com:8788"
# or, with TLS reverse proxy:
broker_url = "wss://broker.yourdomain.com"
```

The TURN server details (server URL, secret/credentials) are configured separately in the app's WebRTC ICE server list.

---

## Scaling

The broker is single-process and in-memory. For the current scale (a handful of rooms at a time) this is fine. If you later need multi-instance scaling, introduce a Redis pub/sub layer to fan messages across broker instances behind a load balancer — but that day is far off.
