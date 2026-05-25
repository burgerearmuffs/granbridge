# MP-3 Manual E2E — two bridges, two UIs (WebRTC can't run in jsdom)

This is the real proof of host-authoritative sync. Unit tests cover the routing
logic with fakes; this exercises the full cross-process / cross-machine path.

## Setup (one machine, two instances — simplest)
1. Start the broker (MP-1): from `server/`, `docker compose up` (or run the broker
   directly). Note its WS URL, e.g. `ws://127.0.0.1:8788`.
2. Host bridge: `granbridge serve` (UI at http://127.0.0.1:8080, WS :8787).
3. Guest bridge: run a second instance on different ports (set `GRANBRIDGE_WS_PORT`
   / `GRANBRIDGE_HTTP_PORT` so they don't collide), or run it on a second machine.
4. Open each UI in its own browser profile/window → Multiplayer tab.

## Run
5. Both: enter the SAME Room ID + password + the broker URL → Join. Confirm video
   tiles + presence ("2 players").
6. The client with the lexicographically smaller broker peer id is the **host** and
   sees "Start match"; the other sees "Waiting for the host…". (Both compute this
   identically — no extra signaling.)
7. Host: pick X01 → Start match. Both UIs show the shared 501 board, host (p1) to throw.
8. Host throws on its board → score updates on BOTH UIs.
9. Board passes to the guest (p2). Guest throws on its board → host engine scores it,
   both UIs update. Verify the host throwing during the guest's turn does NOT score
   (active-player gate).
10. Play a full leg; confirm leg/again alternation and the winner banner on both.

## Reconnect
11. With a match in progress, briefly disconnect the guest (close + rejoin the room).
    On reconnect the host re-pushes the latest `game_state` snapshot — the guest's
    board re-syncs. (Darts thrown while disconnected are lost by design — host is truth.)

## Hardening checks (MP-3 hardening)
12. **Host tab-switch:** with a match in progress, the host switches to another tab
    (Profile/History) and back. The match keeps running — the guest's board keeps
    updating from the host's throws, and the host's video/peer connection is intact
    (no Leave/rejoin needed).
13. **Guest miss:** on the guest's turn, the guest clicks **Miss** — the host engine
    records a miss for the guest; both boards advance correctly. On the host's turn the
    guest's Miss button is disabled.
14. **Guest undo/correct:** the guest throws, then clicks **Undo** (removes their last
    dart) and **Correct** (types e.g. `T20`, replaces their last dart). Both reflect on
    both boards. Undo/Correct are disabled when the guest hasn't thrown this visit.
15. **Rematch:** after a game finishes, the guest clicks **Rematch** — a new match starts
    with the same settings. (The host can also restart via its own Start controls.)
16. **Reconnect:** briefly drop the guest's network (toggle Wi-Fi a few seconds). The
    host/guest shows "Reconnecting…"; on recovery the connection re-establishes and the
    host re-pushes the latest game_state so both boards re-sync. Darts thrown during the
    outage are lost by design (host is truth — re-throw).

## Still-open (future)
- 2-player only (host election by peer-id ordering).
- No replay of darts thrown while disconnected; no formal rematch accept handshake.
- No broker auto-reconnect (peer ICE-restart only — a broker drop still needs a manual Rejoin).
