# MP-3: Host-Authoritative Remote Game Sync — Design (handoff for next session)

> Written 2026-05-22 at the end of a long session, while the engine/bridge/UI internals are fresh,
> so the next (fresh-context) session can go straight to writing-plans + building. MP-1 (broker) and
> MP-2 (WebRTC A/V client + data channel) are DONE and merged. This is the keystone that makes two
> boards in two locations drive ONE match.

## The core problem
There are **two of everything**: each player runs their own GRANBRIDGE bridge (`granbridge serve`,
with its own `GameEngine` + its own board) and their own UI. We need ONE shared match. "Host-
authoritative" = **only the host's bridge engine scores**; the guest's engine stays idle.

## Data path for a guest's dart (the whole trick)
```
guest board → guest bridge (dart_hit on bus) → guest UI (via guest bridge WS)
   → guest UI sends it over the WebRTC data channel (MP-2 PeerManager.sendData)
   → host UI receives it → sends a `remote_dart` command to the HOST bridge (over host bridge WS)
   → host engine applies it (as the guest player's throw) → broadcasts game_state
   → host UI → over data channel → guest UI renders game_state
```
Host's own darts score normally (local board → host engine). The guest UI **does not start a local
game** and **renders only the host's game_state**; it just forwards its darts and displays.

## The crux: turn ownership (this is what's easy to get wrong)
Both boards are live simultaneously. The host engine must apply each dart **only if it belongs to the
active player**, or out-of-turn/stray hits corrupt the score.

Recommended model — **tag every dart with a source player id and gate by active player:**
- `start_game` (issued by host) creates players `[p1=host, p2=guest]` (names from profiles).
- Host's local board darts are tagged `p1`; guest's `remote_dart`s are tagged `p2`.
- Generalize the engine input: `on_dart(dart, source_player_id=None)`. If `source_player_id` is set
  and `!= state.active_player_id`, **ignore the dart** (it's the other player throwing out of turn /
  practice between turns). Local `attach()` darts pass `source=local_player_id` (the host's slot).
- This keeps the engine the single arbiter; neither board can score on the other's turn.

(Edge: who is the host's slot when the host could be p1 OR p2 across legs? Use a fixed mapping for the
match — the bridge knows "I am player X in this remote match" — set once when the remote match starts.)

## New pieces
**Bridge (Python, non-BLE — fine to edit):**
- `game/commands.py`: add `RemoteDart {command:"remote_dart", bed:str, player:str}` (bed reuses
  `Dart.from_bed`). `parse_command` handles it.
- `game/engine.py`: `on_dart(dart, source_player_id=None)` with the active-player gate above;
  `handle_command(RemoteDart)` → `on_dart(Dart.from_bed(cmd.bed), source_player_id=cmd.player)`.
  `attach()` tags local darts with a configurable local player id (default p1).
- A `set_remote_role(local_player_id)` on the engine (or via a `start_remote` command) so the host
  bridge knows which slot its local board feeds.

**UI (`ui/src/multiplayer/`):**
- `remoteMatch.ts`: orchestrates a remote match on top of MP-2's `BrokerClient`/`PeerManager` +
  the existing bridge WS (`useGranbridgeSocket`). Two roles:
  - **Host:** on its bridge `game_state`, `sendData({t:"state", state})` to the guest; on a peer
    data message `{t:"dart", bed}`, send a `remote_dart` command to its bridge WS.
  - **Guest:** on its local bridge `dart_hit`, `sendData({t:"dart", bed})` to the host; on a peer
    `{t:"state", state}`, push it into the store as the rendered game_state (suppress local engine).
- UI: a "Start remote match" flow (host picks mode/options; both see the shared board + each other's
  video from MP-2). Reuse the existing boards/overlays to render the synced `game_state`.

## Reconnect / robustness
- On data-channel (re)open, the host immediately `sendData` a full `game_state` snapshot so a
  reconnecting guest re-syncs. Darts thrown while disconnected are lost by design (host is truth) —
  the host can re-broadcast and players re-throw if needed (acceptable for MVP; note for later).
- Misses: still manual `record_miss` per player, routed like a dart (guest's miss → remote_miss, or
  reuse `record_miss` semantics through the same gated path).

## Testing
- **Unit (bridge):** the turn-ownership gate — `on_dart` with a non-active `source_player_id` is
  ignored; `remote_dart` for the active player scores; a full 2-player alternating sequence (local +
  remote darts) produces the correct shared game_state. Engine tests are pure/deterministic.
- **Unit (UI):** `remoteMatch` host/guest message routing with a fake PeerManager + fake bridge WS
  (assert host forwards state, guest forwards darts, guest renders received state).
- **Manual (E2E):** two bridges + two UIs on localhost (different ports / two machines) — the real
  proof; jsdom can't run WebRTC.

## Start-here checklist for the next session
1. `git pull` (main @ board-validated). Run `pytest -q` (163) + `npm --prefix ui test` to confirm green baseline.
2. Invoke `superpowers:writing-plans` to turn this design into a task plan; build subagent-driven.
3. Order: bridge `RemoteDart` + engine gate (+ tests) → UI `remoteMatch` host/guest (+ tests) →
   "start remote match" UI → reconnect snapshot. Then manual 2-instance E2E.
4. After MP-3: MP-4 profiles/avatars; quick parity modes (Count-Up, Medley); then consider rebuilding
   installers + cutting v0.1.1 with the validated board map.
