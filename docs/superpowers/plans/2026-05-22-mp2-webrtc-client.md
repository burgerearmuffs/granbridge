# MP-2: WebRTC A/V Client — Plan

> Subagent-driven; no subagent commits. Frontend, in `ui/`. No new npm deps (browser WebRTC).
> jsdom has NO `RTCPeerConnection`/`getUserMedia` — so make protocol/identity/UI logic pure+tested,
> and keep the WebRTC glue defensive (guard missing APIs; no-op in tests). Real A/V verified manually.

**Goal:** Two players join a room (ID + password) on the broker and get two-way camera+mic, plus a
data channel for later game-sync. Matches the official app's in-match video (parity-critical).

**Broker protocol (already built, MP-1):** client→`{type:"join",room,password,player:{id,name}}`;
server→`{type:"joined",self,peers:[{peer_id,player}]}`, `{type:"peers",peers:[...]}`,
`{type:"signal",from,data}`, `{type:"msg",from,payload}`, `{type:"error",code,message}`.
client→`{type:"signal",to,data}`, `{type:"msg",payload}`, `{type:"leave"}`.

---

## Task 1: Anonymous identity
**Files:** `ui/src/multiplayer/player.ts` (+ test).
- `getOrCreatePlayer(): {id: string; name: string}` — persists to localStorage `granbridge.player`
  (generate `id` via `crypto.randomUUID()`; default name "Player-" + short id). `setPlayerName(name)`.
- Test: first call creates+persists; second returns same id; setPlayerName updates.

## Task 2: Broker client (testable protocol)
**Files:** `ui/src/multiplayer/brokerClient.ts` (+ test).
- `class BrokerClient` ctor `(url)`. Methods: `connect()`, `join(room,password,player)`, `sendSignal(to,data)`, `sendMsg(payload)`, `leave()`, `close()`. Callbacks/event emitter: `onJoined(self,peers)`, `onPeers(peers)`, `onSignal(from,data)`, `onMsg(from,payload)`, `onError(code,msg)`, `onClose()`. Auto-reconnect on unexpected close (backoff). Uses the global `WebSocket` (so tests can inject a mock).
- Test (mock WebSocket like `useGranbridgeSocket.test.ts` does): `join` sends the correct JSON; an incoming `joined`/`peers`/`signal`/`msg`/`error` message fires the matching callback with parsed args; `sendSignal` emits `{type:"signal",to,data}`.

## Task 3: WebRTC peer manager (guarded glue — light test only)
**Files:** `ui/src/multiplayer/peerManager.ts` (+ a light test), `ui/src/multiplayer/media.ts`.
- `media.ts`: `getLocalStream({video,audio})` wraps `navigator.mediaDevices.getUserMedia`, guarded (returns null if unavailable); `listVideoInputs()`/`listAudioInputs()`.
- `peerManager.ts`: `class PeerManager` given a `BrokerClient`, a `localStream`, and `iceServers`. For each peer (from onPeers), create an `RTCPeerConnection({iceServers})`, add local tracks, create a `data` channel (label "granbridge"), and run **perfect-negotiation** (polite/impolite by comparing peer ids) using the broker's signal relay for SDP+ICE. Emit `onRemoteStream(peerId, MediaStream)`, `onDataMessage(peerId, obj)`, `onPeerState(peerId, state)`. Expose `sendData(obj)` (broadcast over open data channels — for MP-3). Guard the whole thing if `RTCPeerConnection` is undefined (no-op).
- Default `iceServers`: `[{urls:"stun:stun.l.google.com:19302"}]` + a documented slot for the self-hosted TURN (`turn:<TOWER-ip>:3478` with the coturn secret) — configurable.
- Test (with a minimal fake `RTCPeerConnection` assigned to globalThis): creating a PeerManager and feeding it one peer creates a connection and a data channel; `sendData` calls `send` on an (faked) open channel. Keep this light — the real negotiation is verified manually.

## Task 4: Multiplayer store + config
**Files:** `ui/src/multiplayer/store.ts` (or extend `ui/src/store.ts`) (+ test).
- State: `mpStatus` ("idle"|"connecting"|"in_room"|"error"), `room`, `selfId`, `peers:[{peer_id,player}]`, `mic:boolean`, `cam:boolean`, `error?:string`. Actions to set these. Persist `brokerUrl` (default `ws://127.0.0.1:8788`) + mic/cam prefs to localStorage.
- Test: actions update state; brokerUrl persists.

## Task 5: UI — join + video tiles + controls
**Files:** `ui/src/views/Multiplayer.tsx`, `ui/src/components/VideoTile.tsx`, `ui/src/components/MpControls.tsx` (+ a render test for the join form), wire into `ui/src/App.tsx` nav (add a "Multiplayer" tab beside Live/History; hidden in kiosk).
- **Join panel:** display name, room ID, password, broker URL (prefilled) → "Join". Shows status + peer list + errors. On join: get local media, connect broker, start PeerManager.
- **`VideoTile`:** a `<video autoPlay playsInline>` (muted for self) bound to a MediaStream via a ref; label with player name + mic/cam state. Local tile + one per remote peer.
- **`MpControls`:** mute mic, toggle camera, leave room. Reflect/persist state.
- Test (`Multiplayer.test.tsx`): the join form renders its fields and a Join button; entering values + clicking Join invokes the join path (you can mock BrokerClient/getLocalStream — assert it attempts to join with the entered room/password). Keep WebRTC mocked/guarded.

## Task 6: Docs
- README "Multiplayer (beta)" section: run the broker (local `python -m granbridge_broker`, or on TOWER), set the broker URL in-app (`wss://<TOWER>` in production), enter room+password to play; note TURN/iceServers config for through-NAT A/V; note this is the A/V + signaling layer (game-sync is MP-3).

## Verify
`npm --prefix C:\Users\willa\granbridge\ui test` (all pass) + `npm --prefix C:\Users\willa\granbridge\ui run build` (clean). Use safe DOM only — no raw-HTML injection. No new deps.

## Self-Review
- **Coverage:** identity (T1), broker protocol (T2), WebRTC peers + media (T3), state/config (T4), join+video UI (T5), docs (T6).
- **Testable vs manual:** broker client, identity, store, join form = unit-tested; RTCPeerConnection negotiation + real media = guarded + manual (jsdom limitation, documented).
- **Security:** room password (broker-enforced); media only after explicit Join; broker URL user-set; TURN creds via config not committed.
