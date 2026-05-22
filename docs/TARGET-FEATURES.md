# GRANBRIDGE — Target Feature List (Product Vision)

> **Reframed 2026-05-22:** GRANBRIDGE is an **internet-multiplayer game first and foremost** — built to
> deliver the most premium *remote* dart experience: two people (or more) on their own GRANBOARDs in
> different locations, playing a real match together with live video/voice, synced scoring, and profiles.
> Local single-board play is still fully supported, but **remote multiplayer is the primary purpose.**

Status legend: ✅ built · ◐ foundation/partial · ○ designed-not-built · ⚙ needs hosted infra / external service

---

## A. Core (local) — mostly ✅
- ✅ BLE bridge: connect GRANBOARD, decode hits → structured JSON events (⚠ unvalidated on hardware).
- ✅ Game engine: X01 (double in/out, checkout suggestions), Cricket, Around-the-Clock, Free-play;
  3-dart visits, undo/correct-misread, bust handling, legs **and sets**.
- ✅ Desktop app: React UI (web + native Tauri installer), self-serving exe.
- ✅ Rich graphics (SVG dartboard + heatmap, animations), sound effects (procedural + asset slots),
  checkout/celebration videos (procedural + asset slots).
- ✅ Local stats auto-tracking (history DB, 3-dart avgs, win records, heatmaps).
- ✅ Streaming overlays (OBS), plugin/MQTT/integration layer, one-way player-cam overlay.

## B. Internet multiplayer (PRIMARY) — ⚙ mostly not built
- ◐ **Room-based pairing (no matchmaking):** create/join a match by **Room ID + password**. Today only
  a local, unauthenticated relay with room query params exists. Need: room create/join with password,
  presence (who's in the room), reconnect.
- ○ **Remote game sync:** both players' boards feed one shared match; scoring/turns synchronized across
  the internet with a clear authority model (host-authoritative or server-authoritative) + latency/
  reconnect handling + anti-desync.
- ⚙ **Hosted backend:** a signaling + relay service (room registry, auth, presence) reachable over the
  internet. This is the keystone — without hosting, "internet multiplayer" can't exist.
- ○ Spectating (join a room as a viewer), turn clock, rematch.

## C. Video / Voice chat in matches — ○ / ⚙ net-new (NOT the existing player-cams)
- ○ **Two-way A/V between players** via WebRTC (camera + mic), shown in-app during the match
  (player tiles, board-cam optional). This is distinct from the one-way OBS player-cam overlay already built.
- ⚙ Needs **signaling** (can ride the same backend as rooms) + **STUN/TURN** servers for NAT traversal
  (TURN has bandwidth cost / hosting). Mute/camera toggles, push-to-talk, device selection.
- Note the three separate "camera" concepts so they aren't conflated:
  1. one-way player-cams for OBS streaming = ✅ built; 2. **interactive A/V chat = this, ○**;
  3. CV dart-autoscoring = deferred/architecture-only.

## D. Player profiles + identity — ◐ foundation
- ◐ Auto-tracked stats exist locally. Need: a **profile** (display name, avatar, persistent ID),
  career stats (averages, checkouts, win rate, per-segment heatmap) that persist and travel with the
  player across matches/devices.
- ⚙ For online play, profiles imply **identity/accounts** (even lightweight: a generated player ID +
  optional auth) stored server-side, so opponents and stats are stable across sessions.

## E. Streaming & social — partially ✅
- ✅ OBS overlays. ○ In-match spectator links, share match results, Discord rich presence (plugin exists for events).

## F. Future / stretch — ○ (foundations only)
- ◐ AI commentary (offline template built; LLM seam flagged). ○ Tournaments/leagues/brackets.
- ○ Mobile companion. ○ CV camera autoscoring + anti-cheat (architecture doc only).

---

## What this reframing changes
The current codebase is an excellent **local** app. Becoming "internet-multiplayer-first" makes the
**networking + A/V + rooms/profiles backend the central spine**, not a future add-on. Concretely it adds
a hosted service the app talks to, and a WebRTC layer between clients.

**I can build locally/autonomously:** the entire **client side** (room create/join UI + password, WebRTC
peer logic, A/V tiles, profile model + UI, remote game-sync protocol on top of the event bus) and a
**self-hostable backend** (a Python/Node signaling+relay+room server you can run on a VPS), all testable
against `localhost`/loopback with fakes.

**Needs YOU (can't do autonomously — external/infra/cost):**
- A **host** for the backend (a VPS / cloud run / Fly.io / etc.) so it's reachable over the internet.
- A **TURN server** (e.g. coturn self-hosted, or Twilio/metered) for reliable A/V through NATs — has bandwidth cost.
- A decision on **accounts/identity** (anonymous IDs vs. real auth) and where profile data lives.

## Open decisions (for when you're ready — these shape the build)
1. **Sync authority:** host-authoritative (one player's app is the source of truth) vs. server-authoritative
   (the backend runs the match)? Host-auth is simpler + cheaper; server-auth is more robust/anti-cheat.
2. **Backend stack & host:** Python (reuse our code) vs. Node; and where it runs.
3. **A/V transport:** pure peer-to-peer WebRTC (cheap, needs TURN fallback) vs. an SFU (scales to >2 players, more infra).
4. **Identity:** anonymous generated IDs (zero-friction) vs. accounts (durable profiles, more setup).
5. **Scope of "first" remote release:** 2-player X01 with room+password + A/V is the natural MVP.

> Recommended MVP path: host-authoritative sync + room/password via a small self-hostable Python
> signaling/relay server + peer-to-peer WebRTC A/V (with a TURN fallback) + anonymous player IDs that can
> later upgrade to accounts. Build the whole client + server locally now; you provide hosting + TURN to go live.
