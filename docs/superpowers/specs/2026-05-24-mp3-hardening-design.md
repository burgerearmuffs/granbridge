# MP-3 Hardening — Design

> Written 2026-05-24. Closes the four known MVP gaps in host-authoritative remote game sync
> (MP-3, shipped 2026-05-22). Builds on MP-1 (broker), MP-2 (WebRTC A/V + data channel), MP-3
> (remote sync), MP-4 (profiles). No new hosted infra. **2-player only throughout.**

## The four gaps (from `docs/BUILD-LOG.md` MP-3 "Known MVP gaps")
1. **Host tab-switch tears down the match.** `App.tsx` conditionally renders the `Multiplayer`
   view (`activeTab === "multiplayer" ? <Multiplayer/>`), so leaving the tab **unmounts** it.
   The live session (broker, `PeerManager`, `RemoteMatch`, streams) lives in component `useRef`s
   (`Multiplayer.tsx:63-65`), so it is destroyed on unmount; on return the re-init effect
   early-returns (`!pmRef.current`) and the user must Leave + rejoin. (Worse than the documented
   "guest's board pauses".)
2. **Guest misses aren't auto-detected.** The board has no out-zone sensor; misses are manual via
   `record_miss`, and only the host has controls.
3. **Only the host has match controls.** The guest renders state read-only — can't miss, undo,
   correct, or rematch.
4. **No reconnect recovery.** `PeerManager` reports `disconnected`/`failed` via `onPeerState`
   (`peerManager.ts:159-162`) but nothing recovers; the view shows a hard error.

## Decisions (locked during brainstorming)
- **Scope:** all four, **Cluster A (lifecycle) before Cluster B (controls)**.
- **Guest powers:** *self-service turn actions* — record own miss, undo/correct own last throw
  (only on the guest's turn), and rematch (either side). Host keeps start/mode/end.
- **Reconnect bar:** *auto-recover transient drops* — "reconnecting…" indicator + automatic ICE
  restart (bounded) + host re-snapshot on reopen; fall back to manual rejoin. Not full resilience.
- **Session lifetime mechanism:** a **module-level singleton** mirroring `bridgeLink`.
- **Guest→host commands:** **explicit typed request messages**, host-validated + turn-gated.

---

## Cluster A.1 — Session hoist (fixes Gap #1)

A new module-level singleton owns the *live objects*; `useMpStore` holds *reactive render state*;
the view becomes a thin renderer. This mirrors the existing split between `bridgeLink` (live WS
pub/sub in a module) and `useStore` (reactive state). The session is not tied to any React mount,
so navigating tabs is free.

**Why the hoist is sufficient:** the bridge WS is owned at the app root (`App.tsx:22`
`useGranbridgeSocket`), so `bridgeLink`'s sender/listeners stay live across tab switches. Once the
broker/PM/RM also live above the tab boundary (in `mpSession`), nothing in the match path unmounts
on navigation.

**New: `ui/src/multiplayer/session.ts`**
```ts
class MpSession {
  join(opts: { room: string; password: string; displayName: string; brokerUrl: string }): Promise<void>;
  leave(): void;
  startMatch(mode: string, options: Record<string, unknown>): void;  // host
  requestAction(action: GuestAction, bed?: string): void;            // guest
}
export const mpSession = new MpSession();
```
- `join` absorbs today's `handleJoin`: set status, `getLocalStream`, `fetchIceServers`, build
  `BrokerClient`, wire `onJoined`/`onPeers`/`onError`/`onClose`, build `PeerManager` + `RemoteMatch`
  (role from `hostRole`), and the two RemoteMatch wiring effects (`Multiplayer.tsx:77-90`). All
  reactive results are pushed into `useMpStore` via `getState()` (the pattern already used today).
- `leave` absorbs `handleLeave`: `broker.leave()/close()`, `pm.closeAll()`, `rm.stop(true)` (clears
  the engine remote role), stop local tracks, `resetMp()`.
- `startMatch` calls `rm.startGame(mode, [hostName, guestName], options)`.
- `requestAction` delegates to `rm.requestAction(...)` (Cluster B).
- Idempotency: `join` while already `in_room`/`connecting` is a no-op (prevents stacked sessions).

**Store additions (`store.ts`, non-persisted):**
`localStream: MediaStream | null`, `remoteStreams: Map<string, MediaStream>`,
`connectionHealth: "connected" | "reconnecting" | "lost"` (default `"connected"`), with setters;
`resetMp()` clears all three.

**View refactor (`Multiplayer.tsx`):**
- Delete `brokerRef`/`pmRef`/`rmRef`, the two RemoteMatch effects, the unmount-teardown effect
  (`:98-101`), and the bodies of `handleJoin`/`handleLeave`/`handleStartMatch`.
- Read everything from `useMpStore` (incl. `localStream`, `remoteStreams`, `connectionHealth`).
- Buttons call `mpSession.join/leave/startMatch/requestAction`.
- Keep the mic/cam → `track.enabled` effect (reads `localStream` from the store) — view-local.

---

## Cluster A.2 — Reconnect (fixes Gap #4)

**`PeerManager` (`peerManager.ts`):**
- New callback `onConnectionHealth: (peerId: string, health: "connected" | "reconnecting" | "lost") => void`.
- Per-peer retry counter; `MAX_ICE_RESTARTS = 3`, backoff `[1s, 2s, 4s]`.
- In `onconnectionstatechange`:
  - `"connected"` → reset retries; `onConnectionHealth(id, "connected")`.
  - `"disconnected" | "failed"` → `_attemptRestart(id)`.
- `_attemptRestart(id)`: if `retries < MAX` → emit `"reconnecting"`, schedule (backoff) a
  `pc.restartIce()` (guarded: `typeof pc.restartIce === "function"` — absent in jsdom), `retries++`;
  else → emit `"lost"`. `restartIce()` flows through the existing `onnegotiationneeded` → a new
  offer under perfect negotiation.

**Session:** forwards `onConnectionHealth` into `store.connectionHealth`.

**View:** `connectionHealth === "reconnecting"` → a non-fatal "Reconnecting…" banner; `"lost"` →
error state + a Rejoin affordance (re-runs `join`). On data-channel reopen the host already
re-pushes `_lastState` (`remoteMatch.ts:119-121`) so both boards re-sync. Darts thrown during the
gap are lost by design (host is truth; re-throw).

---

## Cluster B — Guest control authority (fixes Gaps #2 + #3)

**Protocol (`remoteMatch.ts`):** extend `SyncMsg`:
```ts
type GuestAction = "miss" | "undo" | "correct" | "rematch";
type SyncMsg =
  | { t: "state"; state: GameState }
  | { t: "dart"; bed: string }
  | { t: "card"; profile: Profile; summary: CareerSummary }
  | { t: "req"; action: GuestAction; bed?: string };   // NEW (guest → host)
```
`isSyncMsg` validates `t:"req"`: `action` ∈ the four strings; when `action === "correct"`,
`bed` is a string. (Same defensive per-`t` validation already used for untrusted peer messages.)

**Guest side:**
- `RemoteMatch.requestAction(action, bed?)` (guest role) → `peer.sendData({ t:"req", action, bed })`.
- A guest control bar in the Multiplayer view (shown when `role === "guest"` and a `gameState`
  exists): **Miss / Undo / Correct** are shown while `status === "in_progress"` and enabled only
  when the active player is the guest slot
  (`gameState.players[gameState.active_index]?.id === guestSlot`); **Rematch** is shown when
  `status === "finished"`. **Correct** reuses the host's existing bed-entry affordance (locate it in
  `LiveGame`/controls during planning), routing the chosen bed through `requestAction("correct", bed)`.

**Host side** (`RemoteMatch._onPeerMessage`, `role === "host" && msg.t === "req"`):
```ts
const st = this._lastState; if (!st) return;
const activeId = st.players[st.active_index]?.id;
const guestTurn = activeId === this._opts.guestSlot;     // guestSlot default "p2"
switch (msg.action) {
  case "miss":    if (guestTurn) bridge.send({ command: "record_miss" }); break;
  case "undo":    if (guestTurn && st.visit.length > 0) bridge.send({ command: "undo" }); break;
  case "correct": if (guestTurn && st.visit.length > 0 && typeof msg.bed === "string")
                    bridge.send({ command: "correct_last", bed: msg.bed }); break;
  case "rematch": if (st.status === "finished" && this._lastStart)
                    bridge.send({ command: "start_game", ...this._lastStart }); break;
}
```
- `startGame` records `this._lastStart = { mode, players, options }` for rematch. The engine's remote
  role persists across a finished game (never cleared until `leave`), so rematch needs only
  `start_game`. Players list order is preserved (`[hostName, guestName]` → p1=host, p2=guest).
  The **host's** own rematch needs nothing new: `Multiplayer.tsx` already re-shows the host Start
  controls once `status !== "in_progress"`, so the host restarts via `startMatch`.

**Engine (Python): no changes.** `record_miss` → `on_dart(Dart.from_bed("MISS"))`,
`undo` → `_undo_last()`, `correct_last` → `_correct_last(bed)`, `start_game` → `_start` all already
exist (`engine.py:71-88`) and apply to the **active** player; none are source-gated, so the
host-side turn-gate above is the sole authority. This keeps the Python/BLE-adjacent surface
untouched.

---

## Error handling & edge cases
- Malformed/unknown peer messages are dropped by `isSyncMsg` (existing guard). Out-of-turn or
  invalid `req`s are silently ignored host-side — no `ErrorEvent` spam to the engine bus.
- The `visit.length > 0` guard prevents a guest `undo`/`correct` from unwinding the **host's**
  throw (when the guest has thrown nothing this visit, the prior dart belongs to the host).
- Rematch is ignored unless `status === "finished"`.
- `leave()` sends `set_remote_role: null` so a later **local** game on that bridge isn't gated.
- With the hoist, the host can be on another tab mid-match and the session keeps forwarding
  `game_state` and processing guest darts/requests — Gap #1's freeze cannot recur.

## Testing
- **UI unit (vitest, WebRTC-free):**
  - `session.test.ts` — `join` drives the store (status/peers/streams), `join` is idempotent,
    `leave` clears role + resets store, `startMatch`/`requestAction` delegate to `RemoteMatch`
    (fake broker/PM/bridge).
  - `remoteMatch.test.ts` (extend) — each guest action maps to the correct host command; turn-gate
    drops out-of-turn `miss`/`undo`/`correct`; `undo`/`correct` dropped when `visit` empty;
    `rematch` only when finished; `isSyncMsg` accepts/rejects `req` shapes; `requestAction` sends
    the right payload.
  - `peerManager.test.ts` (extend) — `restartIce` called (bounded) on `disconnected`/`failed`;
    `onConnectionHealth` emits `connected`/`reconnecting`/`lost` (fake `RTCPeerConnection`).
- **Python:** one regression test — under a set remote role, host-issued `record_miss`/
  `correct_last` apply to the active (guest) slot; locks the host-gated contract.
- **Manual E2E** (`docs/MANUAL-E2E-mp3.md` additions): host tab-switch mid-match → play continues
  and the guest keeps updating; guest miss/undo/correct on their own turn; guest rematch after a
  finish; brief guest network drop → "Reconnecting…" → auto-recovers + re-syncs.

## Non-goals
2-player only (host election unchanged); no guest `next_player`/`start`/`mode`/`end`; no replay of
darts thrown while disconnected; no formal rematch offer/accept handshake (a rematch restarts with
the prior settings); no broker auto-reconnect (peer ICE-restart only — a broker drop still prompts a
manual rejoin).

## Build order
**A:** (1) `mpSession` hoist + store fields + view refactor + tests → (2) reconnect (PeerManager
ICE-restart + `connectionHealth` + banner) + tests.
**B:** (3) `req` protocol + host gating + `RemoteMatch` tests → (4) guest control bar UI →
(5) E2E doc additions + the Python regression test.
