# GRANBRIDGE — Internet Multiplayer Architecture (Spec)

- **Date:** 2026-05-22 · Self-approved (autonomous mandate); direction confirmed by user.
- **Status:** This is now the PRIMARY product thrust (see `docs/TARGET-FEATURES.md`).

## Locked decisions
- **Self-hosted**, on the user's Proxmox box "TOWER" (public IP). The backend is a **separate server
  app, Dockerized** (its own container). User provides hosting + opens the port.
- **Host-authoritative** match sync (one player's app is the source of truth).
- **Anonymous player IDs** (generated, persisted locally; upgradeable to accounts later).
- **WebRTC peer-to-peer** for A/V + a data channel for game-sync; the server only does signaling.
- **Self-hosted coturn (TURN)** in the compose for NAT traversal fallback.

## Three components
1. **Bridge** (existing, per player): local GRANBOARD → events on the local bus/WS. Unchanged.
2. **Client** (existing desktop app, extended): UI + a **WebRTC peer**. Creates/joins a room on the
   broker, establishes a peer connection to the opponent, streams camera/mic, and runs the
   host-authoritative game-sync over a data channel.
3. **Broker** (NEW, Dockerized server on TOWER): rooms + password + presence + **WebRTC signaling
   relay**. Thin and cheap — it brokers the handshake; it does NOT run the match or (normally) carry
   media. Stateless except for in-memory room membership.

```
Player A bridge ─┐                              ┌─ Player B bridge
                 ▼                              ▼
        Client A (WebRTC peer) ◀══ P2P A/V + data channel ══▶ Client B (WebRTC peer)
                 │   (host-authoritative match runs on the host client)   │
                 └────────── signaling (join/password/SDP/ICE) ───────────┘
                                          │
                                  Broker (Docker @ TOWER:public-ip)
                                  rooms · password · presence · signal relay
                                          │  (coturn TURN fallback for media)
```

## Broker protocol (WebSocket, JSON messages)
- `join {room, password, player:{id,name}}` → first joiner sets the room password; later joiners are
  validated. On success the server replies `joined {self, peers:[...]}` and broadcasts `peers` to the room.
- `signal {to:<peerId>, data}` → forwarded to that peer as `signal {from:<peerId>, data}` (carries
  WebRTC SDP offer/answer + ICE candidates).
- `msg {payload}` → broadcast to OTHER peers in the room (generic app channel / game-sync fallback).
- `leave` / disconnect → presence update; empty rooms are reaped.
- `error {code, message}` for bad password, room full, etc. Rooms cap at a configurable size (default 4).

## Host-authoritative game sync (over the WebRTC data channel)
- The room's **host** (first joiner / room creator) runs the authoritative `GameEngine`.
- Each non-host player's bridge forwards its **dart_hit** events to the host (data channel); the host
  applies all darts to the single shared match (respecting whose turn it is) and broadcasts
  **game_state** back to all peers, who render it. Commands (start/next/undo) are issued to the host.
- Reconnect: on data-channel drop, peers re-handshake via the broker and the host re-sends a full
  game_state snapshot.

## Build decomposition (sub-projects)
- **MP-1 (this slice): the Dockerized broker server.** Standalone Python app under `server/`: rooms,
  password, presence, signaling/msg relay; Dockerfile + docker-compose (broker + coturn); tests; deploy doc.
- **MP-2: client WebRTC + A/V** — RTCPeerConnection, camera/mic tiles, mute/cam toggles, room
  create/join (ID + password) UI; broker client; data channel.
- **MP-3: host-authoritative remote sync** — forward remote dart_hits to host; host broadcasts
  game_state; turn ownership; reconnect/snapshot.
- **MP-4: player profiles** — anonymous persistent ID + name/avatar; tie into stats/history.

## What needs the user (infra)
- Run the broker container on TOWER and expose its port on the public IP (compose provided).
- Provide coturn realm/secret env (compose stub provided) and open the TURN ports.
- DNS/TLS optional but recommended (a hostname + wss:// via a reverse proxy) — documented as a follow-up.

## Testability
Broker is fully testable locally (websockets on localhost). Client WebRTC protocol logic is unit-
testable with a fake RTCPeerConnection; real A/V is verified manually in the browser/Tauri webview.
