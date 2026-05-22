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

## Known MVP limitations (note for MP-4+)
- Guest **miss** isn't auto-detected (board has no out-zone sensor); the host can
  `correct_last` / `record_miss`. Only the host has game controls in the remote view.
- Host election is by peer-id ordering (fine for 2 players); >2 players / explicit
  host choice is future work.
- The remote match lives in the Multiplayer tab. Switching the host away mid-match
  keeps the engine gate armed (scoring stays correct), but the host UI stops
  forwarding `game_state` while unmounted, so the guest's board pauses until the
  host returns and the next state is produced. Reconnect/snapshot covers larger gaps.
