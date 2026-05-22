# MP-3: Host-Authoritative Remote Game Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make two GRANBOARDs in two locations drive ONE shared match, where only the host's Python bridge engine scores and both UIs render the host's `game_state`.

**Architecture:** Host-authoritative. The host's bridge `GameEngine` is the single arbiter. A guest's dart travels: guest board → guest bridge WS (`dart_hit`) → guest UI → WebRTC data channel (MP-2 `PeerManager`) → host UI → host bridge WS (`remote_dart` command) → host engine applies it (gated by active player) → broadcasts `game_state` → host UI → data channel → guest UI renders it. The engine gains a per-dart `source_player_id` and an active-player gate that is **opt-in** (disabled for normal local play). The UI gains a pure `RemoteMatch` orchestrator and a tiny `bridgeLink` pub/sub that connects the single bridge WebSocket to the Multiplayer view.

**Tech Stack:** Python 3.14 + pydantic (bridge/engine), pytest. React 18 + TypeScript + Zustand + Vitest (UI). WebRTC data channel from MP-2.

**Branch:** All work on `mp3-remote-sync` (cut from `main`), fast-forward-merged to `main` after review — matching the established per-sub-project pattern.

**Baseline (already confirmed green at plan time):** 163 Python tests (`.venv/Scripts/python.exe -m pytest -q`) + 168 UI tests (`npm --prefix ui test`). Each task must keep both suites green.

**Key design decision — the turn gate must NOT break local play:** In a *local* 2-player game both players throw on the **same** board, so every `dart_hit` enters identically with no per-dart source. Therefore `_local_player_id` defaults to **`None`** (gate disabled) and `on_dart` only gates when `source_player_id is not None`. Remote mode opts in via `set_remote_role("p1")`. This keeps local play byte-for-byte unchanged.

---

## File Structure

**Bridge (Python — non-BLE, safe to edit):**
- Modify `src/granbridge/game/commands.py` — add `RemoteDart` + `SetRemoteRole` commands, register them.
- Modify `src/granbridge/game/engine.py` — `on_dart(dart, source_player_id=None)` gate, `set_remote_role()`, `attach()` tags local darts, `handle_command` routes the two new commands.
- Modify `tests/game/test_commands.py` — parse tests for the new commands.
- Create `tests/game/test_remote_sync.py` — the turn-ownership gate + full alternating sequence + local-play regression.

**UI (TypeScript):**
- Modify `ui/src/types.ts` — add `remote_dart` + `set_remote_role` to the `Command` union.
- Modify `ui/src/multiplayer/peerManager.ts` — add `onChannelOpen` callback (fired on data-channel open) for reconnect snapshots.
- Modify `ui/src/multiplayer/peerManager.test.ts` — test `onChannelOpen`.
- Create `ui/src/multiplayer/remoteMatch.ts` — pure `RemoteMatch` orchestrator + `hostRole()` helper.
- Create `ui/src/multiplayer/remoteMatch.test.ts` — host/guest routing + reconnect + role election.
- Create `ui/src/bridgeLink.ts` — shared pub/sub bridging the single bridge WS to non-prop-path consumers.
- Create `ui/src/bridgeLink.test.ts`.
- Modify `ui/src/useGranbridgeSocket.ts` — publish inbound events + register sender into `bridgeLink`.
- Modify `ui/src/views/Multiplayer.tsx` — "Start remote match" panel (host) / waiting note (guest), `RemoteMatch` lifecycle, synced board.
- Modify `ui/src/views/Multiplayer.test.tsx` — host/guest panel + synced-board render tests.

**Docs:**
- Create `docs/MANUAL-E2E-mp3.md` — 2-instance manual test checklist (jsdom can't run WebRTC).
- Modify `docs/BUILD-LOG.md` — MP-3 entry.

---

## Task 1: Bridge — `RemoteDart` + `SetRemoteRole` commands

**Files:**
- Modify: `src/granbridge/game/commands.py`
- Test: `tests/game/test_commands.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/game/test_commands.py`, and update the import on line 2 to include the new models:

```python
# line 2 becomes:
from granbridge.game.commands import (
    parse_command, StartGame, NextPlayer, Undo, CorrectLast, RecordMiss, EndGame,
    RemoteDart, SetRemoteRole,
)
```

```python
# appended at end of file:
def test_parse_remote_dart():
    cmd = parse_command({"command": "remote_dart", "bed": "T20", "player": "p2"})
    assert isinstance(cmd, RemoteDart) and cmd.bed == "T20" and cmd.player == "p2"

def test_parse_set_remote_role():
    cmd = parse_command({"command": "set_remote_role", "player": "p1"})
    assert isinstance(cmd, SetRemoteRole) and cmd.player == "p1"

def test_parse_set_remote_role_defaults_none():
    cmd = parse_command({"command": "set_remote_role"})
    assert isinstance(cmd, SetRemoteRole) and cmd.player is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/game/test_commands.py -q`
Expected: FAIL — `ImportError: cannot import name 'RemoteDart'`.

- [ ] **Step 3: Implement the commands**

In `src/granbridge/game/commands.py`: (a) change the import on line 3 to add `Optional`; (b) add the two models immediately before the `Command = Union[...]` line; (c) extend `Command` and `_BY_NAME`. Final file:

```python
from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel


class StartGame(BaseModel):
    command: Literal["start_game"]
    mode: str
    players: list[str]
    options: dict[str, Any] = {}


class NextPlayer(BaseModel):
    command: Literal["next_player"]


class RecordMiss(BaseModel):
    command: Literal["record_miss"]


class Undo(BaseModel):
    command: Literal["undo"]


class CorrectLast(BaseModel):
    command: Literal["correct_last"]
    bed: str


class EndGame(BaseModel):
    command: Literal["end_game"]


class RemoteDart(BaseModel):
    command: Literal["remote_dart"]
    bed: str
    player: str


class SetRemoteRole(BaseModel):
    command: Literal["set_remote_role"]
    player: Optional[str] = None


Command = Union[StartGame, NextPlayer, RecordMiss, Undo, CorrectLast, EndGame, RemoteDart, SetRemoteRole]

_BY_NAME = {
    "start_game": StartGame, "next_player": NextPlayer, "record_miss": RecordMiss,
    "undo": Undo, "correct_last": CorrectLast, "end_game": EndGame,
    "remote_dart": RemoteDart, "set_remote_role": SetRemoteRole,
}


def parse_command(payload: dict) -> Command:
    name = payload.get("command")
    model = _BY_NAME.get(name)
    if model is None:
        raise ValueError(f"unknown command: {name!r}")
    return model.model_validate(payload)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/game/test_commands.py -q`
Expected: PASS (all command parse tests, including the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/granbridge/game/commands.py tests/game/test_commands.py
git commit -m "feat(game): remote_dart + set_remote_role commands (MP-3)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Engine — turn-ownership gate, remote role, attach tagging

**Files:**
- Modify: `src/granbridge/game/engine.py`
- Test: `tests/game/test_remote_sync.py` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/game/test_remote_sync.py`:

```python
from granbridge.core.bus import EventBus
from granbridge.game.engine import GameEngine
from granbridge.game.commands import StartGame, RemoteDart, SetRemoteRole
from granbridge.game.models import Dart


def _engine():
    return GameEngine(EventBus())


def _start_remote(eng, **opts):
    """Start a 2-player x01 match in remote mode with the host's local slot = p1."""
    eng.handle_command(SetRemoteRole(command="set_remote_role", player="p1"))
    eng.handle_command(StartGame(command="start_game", mode="x01",
                                 players=opts.pop("players", ["Host", "Guest"]),
                                 options=opts or {"start_score": 501}))


def test_local_dart_scores_for_active_host():
    eng = _engine(); _start_remote(eng, start_score=501)
    eng.on_dart(Dart.from_bed("T20"), source_player_id="p1")  # p1 is active
    assert eng.state.mode_view["scores"]["p1"] == 441


def test_out_of_turn_local_dart_ignored():
    eng = _engine(); _start_remote(eng, start_score=501)
    for _ in range(3):                                       # advance to p2
        eng.on_dart(Dart.from_bed("S1"), source_player_id="p1")
    assert eng.state.active_index == 1
    before = eng.state.mode_view["scores"]["p1"]
    eng.on_dart(Dart.from_bed("T20"), source_player_id="p1")  # host throws on p2's turn
    assert eng.state.mode_view["scores"]["p1"] == before      # ignored
    assert eng.state.active_index == 1


def test_remote_dart_scores_for_active_guest():
    eng = _engine(); _start_remote(eng, start_score=501)
    for _ in range(3):
        eng.on_dart(Dart.from_bed("S1"), source_player_id="p1")
    assert eng.state.active_index == 1
    eng.handle_command(RemoteDart(command="remote_dart", bed="T20", player="p2"))
    assert eng.state.mode_view["scores"]["p2"] == 441


def test_remote_dart_out_of_turn_ignored():
    eng = _engine(); _start_remote(eng, start_score=501)
    eng.handle_command(RemoteDart(command="remote_dart", bed="T20", player="p2"))  # p1 active
    assert eng.state.mode_view["scores"]["p2"] == 501


def test_full_alternating_sequence():
    eng = _engine(); _start_remote(eng, start_score=501)
    for _ in range(3):
        eng.on_dart(Dart.from_bed("T20"), source_player_id="p1")  # p1: 180
    assert eng.state.active_index == 1
    assert eng.state.mode_view["scores"]["p1"] == 501 - 180
    for _ in range(3):
        eng.handle_command(RemoteDart(command="remote_dart", bed="T19", player="p2"))  # p2: 171
    assert eng.state.active_index == 0
    assert eng.state.mode_view["scores"]["p2"] == 501 - 171


def test_gate_disabled_in_local_play():
    """Regression: with no remote role set (one shared board), darts always apply
    to the active player even as it alternates p1->p2."""
    eng = _engine()
    eng.handle_command(StartGame(command="start_game", mode="x01",
                                 players=["A", "B"], options={"start_score": 501}))
    for _ in range(3):
        eng.on_dart(Dart.from_bed("S20"))  # p1 (source defaults to None)
    assert eng.state.active_index == 1
    for _ in range(3):
        eng.on_dart(Dart.from_bed("S20"))  # p2 — must still score
    assert eng.state.mode_view["scores"]["p1"] == 501 - 60
    assert eng.state.mode_view["scores"]["p2"] == 501 - 60


def test_set_remote_role_none_disables_gate():
    eng = _engine(); _start_remote(eng, start_score=501)
    eng.handle_command(SetRemoteRole(command="set_remote_role", player=None))
    for _ in range(3):
        eng.on_dart(Dart.from_bed("S20"), source_player_id="p1")
    assert eng.state.active_index == 1
    # role cleared → a p1-tagged dart on p2's turn now applies (local semantics)
    eng.on_dart(Dart.from_bed("S20"), source_player_id="p1")
    assert eng.state.mode_view["scores"]["p2"] == 501 - 20
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/game/test_remote_sync.py -q`
Expected: FAIL — `TypeError: on_dart() got an unexpected keyword argument 'source_player_id'`.

- [ ] **Step 3: Implement the engine changes**

In `src/granbridge/game/engine.py`, make four edits:

(a) Extend the commands import (lines 9-11) to add `RemoteDart, SetRemoteRole`:

```python
from granbridge.game.commands import (
    Command, CorrectLast, EndGame, NextPlayer, RecordMiss, RemoteDart, SetRemoteRole, StartGame, Undo,
)
```

(b) In `__init__`, add the local-slot field after `self._pending: list = []`:

```python
        self._pending: list = []
        self._local_player_id: Optional[str] = None
```

(c) In `attach()`, tag local board darts with the local slot:

```python
    async def attach(self) -> None:
        with self._bus.subscribe() as sub:
            while True:
                event = await sub.get()
                if isinstance(event, DartHit) and self.state.status == GameStatus.IN_PROGRESS:
                    self.on_dart(
                        Dart(bed=event.bed, ring=event.ring.value, segment=event.segment,
                             multiplier=event.multiplier, score=event.score),
                        source_player_id=self._local_player_id,
                    )
                    await self._flush()
```

(d) In `handle_command`, add two `elif` branches after the `EndGame` branch (before the method ends):

```python
        elif isinstance(cmd, EndGame):
            self.state.status = GameStatus.WAITING
            self._emit_state()
        elif isinstance(cmd, RemoteDart):
            self._guard(lambda: self.on_dart(Dart.from_bed(cmd.bed), source_player_id=cmd.player))
        elif isinstance(cmd, SetRemoteRole):
            self.set_remote_role(cmd.player)
```

(e) Replace the `on_dart` signature + opening guard to add the gate, and add `set_remote_role` directly after `handle_command`/`_guard`. The new `on_dart` header:

```python
    def on_dart(self, dart: Dart, source_player_id: Optional[str] = None) -> None:
        if self.state.status != GameStatus.IN_PROGRESS or self._mode is None:
            self._emit(ErrorEvent(category="command", message="dart with no game in progress"))
            return
        if source_player_id is not None and source_player_id != self.state.active_player_id:
            return  # out-of-turn / stray board hit — the host engine is the single arbiter
        self._push_undo()
        pid = self.state.active_player_id
        result = self._mode.apply_dart(self.state, dart)
        # ... (rest of on_dart unchanged)
```

Add this method (e.g. immediately after the `_guard` method):

```python
    def set_remote_role(self, local_player_id: Optional[str]) -> None:
        """Set which engine slot the LOCAL board feeds for host-authoritative
        remote play. None disables turn-source gating (normal local play)."""
        self._local_player_id = local_player_id
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/game/test_remote_sync.py -q`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the FULL Python suite (guard against regressions)**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: PASS — 170 passed (163 baseline + 7 new). Pay special attention that `tests/game/test_attach_and_legs.py` and the local-play engine tests still pass (the gate must be inert when `source_player_id` is `None`).

- [ ] **Step 6: Commit**

```bash
git add src/granbridge/game/engine.py tests/game/test_remote_sync.py
git commit -m "feat(game): active-player gate + remote role for host-authoritative sync (MP-3)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: UI — `PeerManager.onChannelOpen` (reconnect-snapshot seam)

**Files:**
- Modify: `ui/src/multiplayer/peerManager.ts`
- Test: `ui/src/multiplayer/peerManager.test.ts`

- [ ] **Step 1: Write the failing test**

In `ui/src/multiplayer/peerManager.test.ts`: (a) add an `onopen` field to `FakeDataChannel`; (b) append the test.

`FakeDataChannel` becomes:

```typescript
class FakeDataChannel {
  readyState: "open" | "closed" = "open";
  sent: string[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  send(data: string) { this.sent.push(data); }
}
```

Append inside the `describe("PeerManager ...")` block:

```typescript
  it("fires onChannelOpen when the created data channel opens", () => {
    const broker = makeMockBroker() as unknown as BrokerClient;
    const pm = new PeerManager(broker, "zzz", null); // impolite → creates the channel
    const opened: string[] = [];
    pm.onChannelOpen = (peerId) => opened.push(peerId);

    (broker as any)._emitPeers([{ peer_id: "aaa", player: { id: "p1", name: "Alice" } }]);

    const dc = FakePC.instances[0]._channels[0];
    dc.onopen?.();
    expect(opened).toEqual(["aaa"]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix ui test -- peerManager`
Expected: FAIL — `opened` is `[]` (no `onChannelOpen` wired yet).

- [ ] **Step 3: Implement `onChannelOpen`**

In `ui/src/multiplayer/peerManager.ts`:

(a) Add the public callback alongside the others (after `onPeerState`):

```typescript
  onRemoteStream: (peerId: string, stream: MediaStream) => void = () => {};
  onDataMessage: (peerId: string, obj: unknown) => void = () => {};
  onPeerState: (peerId: string, state: PeerState) => void = () => {};
  onChannelOpen: (peerId: string) => void = () => {};
```

(b) In `_createPeerConnection`, in the impolite branch that creates the channel, add `dc.onopen`:

```typescript
    if (!isPolite) {
      const dc = pc.createDataChannel("granbridge");
      entry.dc = dc;
      dc.onopen = () => this.onChannelOpen(peerId);
      dc.onmessage = (ev) => {
        try { this.onDataMessage(peerId, JSON.parse(ev.data as string)); } catch { /* ignore */ }
      };
    }
```

(c) In the `pc.ondatachannel` handler (polite side receiving the channel), add `onopen`:

```typescript
    pc.ondatachannel = (ev) => {
      entry.dc = ev.channel;
      ev.channel.onopen = () => this.onChannelOpen(peerId);
      ev.channel.onmessage = (me) => {
        try { this.onDataMessage(peerId, JSON.parse(me.data as string)); } catch { /* ignore */ }
      };
    };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix ui test -- peerManager`
Expected: PASS (existing PeerManager tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add ui/src/multiplayer/peerManager.ts ui/src/multiplayer/peerManager.test.ts
git commit -m "feat(mp): PeerManager.onChannelOpen for reconnect snapshots (MP-3)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: UI — `Command` types + `RemoteMatch` orchestrator

**Files:**
- Modify: `ui/src/types.ts`
- Create: `ui/src/multiplayer/remoteMatch.ts`
- Test: `ui/src/multiplayer/remoteMatch.test.ts`

- [ ] **Step 1: Add the remote commands to the `Command` union**

In `ui/src/types.ts`, replace the `Command` type (lines 21-24) with:

```typescript
export type Command =
  | { command: "start_game"; mode: string; players: string[]; options: Record<string, unknown> }
  | { command: "next_player" } | { command: "record_miss" } | { command: "undo" }
  | { command: "correct_last"; bed: string } | { command: "end_game" }
  | { command: "remote_dart"; bed: string; player: string }
  | { command: "set_remote_role"; player: string | null };
```

- [ ] **Step 2: Write the failing tests**

Create `ui/src/multiplayer/remoteMatch.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { RemoteMatch, hostRole } from "./remoteMatch";
import type { BridgeLike, PeerLike } from "./remoteMatch";
import type { Command, Event, GameState } from "../types";

function fakePeer() {
  const sent: unknown[] = [];
  const peer: PeerLike & { sent: unknown[]; fireData: (o: unknown) => void; fireOpen: () => void } = {
    sent,
    sendData: (o) => sent.push(o),
    onDataMessage: () => {},
    onChannelOpen: () => {},
    fireData: (o) => peer.onDataMessage("peer", o),
    fireOpen: () => peer.onChannelOpen("peer"),
  };
  return peer;
}

function fakeBridge() {
  const sent: Command[] = [];
  let cb: ((e: Event) => void) | null = null;
  const bridge: BridgeLike & { sent: Command[]; fireEvent: (e: Event) => void } = {
    sent,
    send: (c) => sent.push(c),
    onEvent: (fn) => { cb = fn; return () => { cb = null; }; },
    fireEvent: (e) => cb?.(e),
  };
  return bridge;
}

const STATE: GameState = {
  mode: "x01", status: "in_progress",
  players: [{ id: "p1", name: "H" }, { id: "p2", name: "G" }],
  active_index: 0, visit: [], legs: {}, sets: {}, winner: null,
  options: {}, mode_view: {}, stats: {},
};
const DART: Event = { type: "dart_hit", bed: "T20", ring: "T", segment: 20, multiplier: 3, score: 60 };

describe("hostRole", () => {
  it("smaller selfId is host", () => {
    expect(hostRole("aaa", [{ peer_id: "zzz", player: { id: "p", name: "n" } }])).toBe("host");
  });
  it("larger selfId is guest", () => {
    expect(hostRole("zzz", [{ peer_id: "aaa", player: { id: "p", name: "n" } }])).toBe("guest");
  });
  it("alone defaults to host", () => {
    expect(hostRole("aaa", [])).toBe("host");
  });
});

describe("RemoteMatch host", () => {
  it("forwards bridge game_state to the peer", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    new RemoteMatch({ role: "host", peer, bridge, applyState: () => {} }).start();
    bridge.fireEvent({ type: "game_state", state: STATE });
    expect(peer.sent).toEqual([{ t: "state", state: STATE }]);
  });

  it("turns a peer dart into a remote_dart command for the guest slot", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    new RemoteMatch({ role: "host", peer, bridge, applyState: () => {} }).start();
    peer.fireData({ t: "dart", bed: "T20" });
    expect(bridge.sent).toEqual([{ command: "remote_dart", bed: "T20", player: "p2" }]);
  });

  it("re-sends the last state when a (re)connecting channel opens", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    new RemoteMatch({ role: "host", peer, bridge, applyState: () => {} }).start();
    bridge.fireEvent({ type: "game_state", state: STATE });
    peer.sent.length = 0;   // clear the initial broadcast
    peer.fireOpen();        // guest reconnects
    expect(peer.sent).toEqual([{ t: "state", state: STATE }]);
  });

  it("startGame sets the remote role then starts the game", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const rm = new RemoteMatch({ role: "host", peer, bridge, applyState: () => {} });
    rm.start();
    rm.startGame("x01", ["H", "G"], { start_score: 501 });
    expect(bridge.sent).toEqual([
      { command: "set_remote_role", player: "p1" },
      { command: "start_game", mode: "x01", players: ["H", "G"], options: { start_score: 501 } },
    ]);
  });

  it("ignores peer state messages (host renders from its own engine)", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const applyState = vi.fn();
    new RemoteMatch({ role: "host", peer, bridge, applyState }).start();
    peer.fireData({ t: "state", state: STATE });
    expect(applyState).not.toHaveBeenCalled();
  });
});

describe("RemoteMatch guest", () => {
  it("forwards local dart_hit events to the peer", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    new RemoteMatch({ role: "guest", peer, bridge, applyState: () => {} }).start();
    bridge.fireEvent(DART);
    expect(peer.sent).toEqual([{ t: "dart", bed: "T20" }]);
  });

  it("applies state pushed by the host", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const applyState = vi.fn();
    new RemoteMatch({ role: "guest", peer, bridge, applyState }).start();
    peer.fireData({ t: "state", state: STATE });
    expect(applyState).toHaveBeenCalledWith(STATE);
  });

  it("does not emit remote_dart commands (guest never scores)", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    new RemoteMatch({ role: "guest", peer, bridge, applyState: () => {} }).start();
    peer.fireData({ t: "dart", bed: "T20" });
    expect(bridge.sent).toEqual([]);
  });

  it("stop() unsubscribes from bridge events", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const rm = new RemoteMatch({ role: "guest", peer, bridge, applyState: () => {} });
    rm.start();
    rm.stop();
    bridge.fireEvent(DART);
    expect(peer.sent).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm --prefix ui test -- remoteMatch`
Expected: FAIL — cannot resolve `./remoteMatch`.

- [ ] **Step 4: Implement `RemoteMatch`**

Create `ui/src/multiplayer/remoteMatch.ts`:

```typescript
/**
 * RemoteMatch — host-authoritative remote game sync (MP-3).
 *
 * Pure orchestrator on top of MP-2's data channel (PeerLike) and the bridge
 * WebSocket (BridgeLike). No React, no WebRTC, no DOM — fully unit-testable.
 *
 * Data-channel protocol (host <-> guest):
 *   guest -> host : { t: "dart", bed }     (a board hit to score)
 *   host  -> guest: { t: "state", state }  (authoritative game_state to render)
 *
 * Host: only its bridge engine scores. On bridge `game_state` it pushes the
 * state to the guest; on a peer `dart` it sends a `remote_dart` command to its
 * bridge tagged with the guest's slot (the engine gates by active player).
 * Guest: never starts a local game; forwards its `dart_hit`s and renders the
 * state the host pushes.
 */

import type { Command, Event, GameState } from "../types";
import type { PeerInfo } from "./brokerClient";

export type RemoteRole = "host" | "guest";

/** The slice of PeerManager that RemoteMatch needs (real PeerManager satisfies it). */
export interface PeerLike {
  sendData(obj: unknown): void;
  onDataMessage: (peerId: string, obj: unknown) => void;
  onChannelOpen: (peerId: string) => void;
}

/** Send a bridge command + subscribe to inbound bridge events (bridgeLink satisfies it). */
export interface BridgeLike {
  send(cmd: Command): void;
  onEvent(cb: (e: Event) => void): () => void;
}

export type SyncMsg =
  | { t: "state"; state: GameState }
  | { t: "dart"; bed: string };

export interface RemoteMatchOptions {
  role: RemoteRole;
  peer: PeerLike;
  bridge: BridgeLike;
  /** Guest-side: apply the host's pushed state (e.g. into the game store). */
  applyState: (state: GameState) => void;
  /** Engine slot the host's local board feeds. Default "p1". */
  hostSlot?: string;
  /** Engine slot the guest's darts are scored as. Default "p2". */
  guestSlot?: string;
}

/**
 * Deterministic host election with NO extra signaling: the peer with the
 * lexicographically smaller id is the host. Both clients compute the same
 * answer from their own id + the peer list. Alone -> "host".
 */
export function hostRole(selfId: string, peers: PeerInfo[]): RemoteRole {
  if (peers.length === 0) return "host";
  return selfId < peers[0].peer_id ? "host" : "guest";
}

export class RemoteMatch {
  private _opts: Required<RemoteMatchOptions>;
  private _unsub: (() => void) | null = null;
  private _lastState: GameState | null = null;
  private _started = false;

  constructor(opts: RemoteMatchOptions) {
    this._opts = { hostSlot: "p1", guestSlot: "p2", ...opts };
  }

  /** Wire peer + bridge callbacks. Idempotent. */
  start(): void {
    if (this._started) return;
    this._started = true;
    const { role, peer, bridge } = this._opts;

    peer.onDataMessage = (_peerId, obj) => this._onPeerMessage(obj as SyncMsg);

    if (role === "host") {
      // Re-send the latest snapshot whenever a (re)connecting guest channel opens.
      peer.onChannelOpen = () => {
        if (this._lastState) peer.sendData({ t: "state", state: this._lastState });
      };
      this._unsub = bridge.onEvent((e) => {
        if (e.type === "game_state") {
          this._lastState = e.state;
          peer.sendData({ t: "state", state: e.state });
        }
      });
    } else {
      peer.onChannelOpen = () => {};
      this._unsub = bridge.onEvent((e) => {
        if (e.type === "dart_hit") {
          peer.sendData({ t: "dart", bed: e.bed });
        }
      });
    }
  }

  /** Host only: begin a remote match — set the engine role, then start the game. */
  startGame(mode: string, players: string[], options: Record<string, unknown>): void {
    if (this._opts.role !== "host") return;
    this._opts.bridge.send({ command: "set_remote_role", player: this._opts.hostSlot });
    this._opts.bridge.send({ command: "start_game", mode, players, options });
  }

  stop(): void {
    this._unsub?.();
    this._unsub = null;
    this._started = false;
    // Clear the gate so a later local game on the host bridge isn't filtered.
    if (this._opts.role === "host") {
      this._opts.bridge.send({ command: "set_remote_role", player: null });
    }
  }

  private _onPeerMessage(msg: SyncMsg): void {
    const { role, bridge, guestSlot, applyState } = this._opts;
    if (role === "host") {
      if (msg && msg.t === "dart") {
        bridge.send({ command: "remote_dart", bed: msg.bed, player: guestSlot });
      }
    } else if (msg && msg.t === "state") {
      applyState(msg.state);
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix ui test -- remoteMatch`
Expected: PASS (12 tests: 3 hostRole + 5 host + 4 guest).

- [ ] **Step 6: Commit**

```bash
git add ui/src/types.ts ui/src/multiplayer/remoteMatch.ts ui/src/multiplayer/remoteMatch.test.ts
git commit -m "feat(mp): RemoteMatch host/guest sync orchestrator + role election (MP-3)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: UI — `bridgeLink` shared pub/sub + socket wiring

**Files:**
- Create: `ui/src/bridgeLink.ts`
- Test: `ui/src/bridgeLink.test.ts`
- Modify: `ui/src/useGranbridgeSocket.ts`

- [ ] **Step 1: Write the failing tests**

Create `ui/src/bridgeLink.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { bridgeLink } from "./bridgeLink";
import type { Event } from "./types";

afterEach(() => {
  bridgeLink.setSender(null);
});

const DART: Event = { type: "dart_hit", bed: "T20", ring: "T", segment: 20, multiplier: 3, score: 60 };

describe("bridgeLink", () => {
  it("delivers emitted events to subscribers", () => {
    const seen: Event[] = [];
    const off = bridgeLink.onEvent((e) => seen.push(e));
    bridgeLink.emit(DART);
    expect(seen).toEqual([DART]);
    off();
  });

  it("stops delivering after unsubscribe", () => {
    const seen: Event[] = [];
    const off = bridgeLink.onEvent((e) => seen.push(e));
    off();
    bridgeLink.emit(DART);
    expect(seen).toEqual([]);
  });

  it("routes send() through the registered sender", () => {
    const sender = vi.fn();
    bridgeLink.setSender(sender);
    bridgeLink.send({ command: "next_player" });
    expect(sender).toHaveBeenCalledWith({ command: "next_player" });
  });

  it("send() is a safe no-op when no sender is registered", () => {
    bridgeLink.setSender(null);
    expect(() => bridgeLink.send({ command: "undo" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix ui test -- bridgeLink`
Expected: FAIL — cannot resolve `./bridgeLink`.

- [ ] **Step 3: Implement `bridgeLink`**

Create `ui/src/bridgeLink.ts`:

```typescript
/**
 * bridgeLink — a tiny shared pub/sub bridging the single Granbridge bridge
 * WebSocket (owned by useGranbridgeSocket) to consumers that are NOT on the
 * App -> Controls prop path, e.g. the Multiplayer view's RemoteMatch.
 *
 *   useGranbridgeSocket: each inbound event -> bridgeLink.emit(event)
 *                        on mount           -> bridgeLink.setSender(send)
 *   RemoteMatch:         bridge.onEvent(...) / bridge.send(...)
 *
 * Satisfies remoteMatch.BridgeLike (send + onEvent).
 */
import type { Command, Event } from "./types";

type Listener = (e: Event) => void;

const listeners = new Set<Listener>();
let sender: ((cmd: Command) => void) | null = null;

export const bridgeLink = {
  emit(e: Event): void {
    for (const l of listeners) l(e);
  },
  onEvent(cb: Listener): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
  setSender(fn: ((cmd: Command) => void) | null): void {
    sender = fn;
  },
  send(cmd: Command): void {
    sender?.(cmd);
  },
};
```

- [ ] **Step 4: Wire it into the socket hook**

Replace `ui/src/useGranbridgeSocket.ts` with:

```typescript
import { useEffect, useRef, useCallback } from "react";
import { useStore } from "./store";
import type { Command, Event } from "./types";
import { soundManager } from "./sound/SoundManager";
import { bridgeLink } from "./bridgeLink";

export function useGranbridgeSocket(url = `ws://127.0.0.1:8787`) {
  const ws = useRef<WebSocket | null>(null);
  const apply = useStore((s) => s.applyEvent);
  const setConnection = useStore((s) => s.setConnection);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const sock = new WebSocket(url);
      ws.current = sock;
      sock.onopen = () => setConnection("connected");
      sock.onmessage = (m: MessageEvent) => {
        try {
          const event = JSON.parse(m.data) as Event;
          apply(event);
          soundManager.handleEvent(event);
          bridgeLink.emit(event);
        } catch { /* ignore malformed */ }
      };
      sock.onclose = () => {
        setConnection("disconnected");
        if (!closed) retry = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws.current?.close(); };
  }, [url, apply, setConnection]);

  const send = useCallback((cmd: Command) => {
    if (ws.current && ws.current.readyState === 1) ws.current.send(JSON.stringify(cmd));
  }, []);

  // Expose the sender to non-prop-path consumers (Multiplayer view / RemoteMatch).
  useEffect(() => {
    bridgeLink.setSender(send);
    return () => bridgeLink.setSender(null);
  }, [send]);

  return { send };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix ui test -- bridgeLink useGranbridgeSocket`
Expected: PASS — the 4 new bridgeLink tests and the existing `useGranbridgeSocket.test.ts` test (the added `emit`/`setSender` are inert when nothing subscribes).

- [ ] **Step 6: Commit**

```bash
git add ui/src/bridgeLink.ts ui/src/bridgeLink.test.ts ui/src/useGranbridgeSocket.ts
git commit -m "feat(mp): bridgeLink pub/sub connecting the bridge WS to RemoteMatch (MP-3)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: UI — Multiplayer view: start-match panel, lifecycle, synced board

**Files:**
- Modify: `ui/src/views/Multiplayer.tsx`
- Test: `ui/src/views/Multiplayer.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `ui/src/views/Multiplayer.test.tsx`. First add a `useStore` import near the top (after the existing `useMpStore` import):

```typescript
import { useStore } from "../store";
```

Then append this `describe` block at the end of the file:

```typescript
describe("Multiplayer in-room match panel", () => {
  function enterRoomAs(selfId: string, peerId: string) {
    useMpStore.setState({
      mpStatus: "in_room",
      room: "r1",
      selfId,
      peers: [{ peer_id: peerId, player: { id: "px", name: "Opponent" } }],
    });
  }

  it("host (smaller peer id) sees the Start match button", () => {
    enterRoomAs("aaa", "zzz");
    render(<Multiplayer />);
    expect(screen.getByRole("button", { name: /start match/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /match mode/i })).toBeInTheDocument();
  });

  it("guest (larger peer id) sees a waiting message, no Start button", () => {
    enterRoomAs("zzz", "aaa");
    render(<Multiplayer />);
    expect(screen.getByText(/waiting for the host/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start match/i })).toBeNull();
  });

  it("renders the synced board when a game is in progress", () => {
    enterRoomAs("aaa", "zzz");
    useStore.setState({
      gameState: {
        mode: "x01", status: "in_progress",
        players: [{ id: "p1", name: "Alice" }, { id: "p2", name: "Bob" }],
        active_index: 0, visit: [], legs: {}, sets: {}, winner: null,
        options: {}, mode_view: {}, stats: {},
      },
    });
    render(<Multiplayer />);
    expect(screen.getByText("Alice")).toBeInTheDocument();          // LiveGame header
    expect(screen.queryByRole("button", { name: /start match/i })).toBeNull();
  });
});
```

Also extend the existing `beforeEach` (around line 72) to clear the main game store so tests don't leak `gameState`. Add this line inside `beforeEach`:

```typescript
  useStore.setState({ gameState: null });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix ui test -- views/Multiplayer`
Expected: FAIL — no "Start match" button / "waiting" text yet (the in_room view has no match panel).

- [ ] **Step 3: Implement the view changes**

In `ui/src/views/Multiplayer.tsx`, make these edits.

(a) Add imports after the existing `MpControls` import (line 23):

```typescript
import { useStore } from "../store";
import { LiveGame } from "./LiveGame";
import { bridgeLink } from "../bridgeLink";
import { RemoteMatch, hostRole } from "../multiplayer/remoteMatch";
```

(b) Add store selectors + local state. After `const brokerUrl = useMpStore((s) => s.brokerUrl);` (line 35) add:

```typescript
  const selfId = useMpStore((s) => s.selfId);
  const peersForRole = useMpStore((s) => s.peers);
  const gameState = useStore((s) => s.gameState);
```

After `const [brokerInput, setBrokerInput] = useState(brokerUrl);` (line 42) add:

```typescript
  const [mpMode, setMpMode] = useState("x01");
```

(c) Add the RemoteMatch ref next to the other refs (after `const pmRef = useRef<PeerManager | null>(null);`, line 50):

```typescript
  const rmRef = useRef<RemoteMatch | null>(null);
```

(d) Add the lifecycle effect right after the mic/cam `useEffect` (after line 57):

```typescript
  // Establish the host-authoritative remote match once we're in a room with a
  // peer and a live PeerManager. Role is derived deterministically from peer ids.
  useEffect(() => {
    if (mpStatus !== "in_room" || !pmRef.current || peersForRole.length === 0 || !selfId) return;
    if (rmRef.current) return;
    const rm = new RemoteMatch({
      role: hostRole(selfId, peersForRole),
      peer: pmRef.current,
      bridge: bridgeLink,
      applyState: (state) => useStore.getState().applyEvent({ type: "game_state", state }),
    });
    rm.start();
    rmRef.current = rm;
  }, [mpStatus, selfId, peersForRole]);
```

(e) In `handleLeave`, tear down the RemoteMatch. After `pmRef.current = null;` (line 127) add:

```typescript
    rmRef.current?.stop();
    rmRef.current = null;
```

(f) Add the start-match handler after `handleLeave` (after its closing `}, [...]);`, around line 133):

```typescript
  const handleStartMatch = useCallback(() => {
    const me = getOrCreatePlayer();
    const opponent = peersForRole[0]?.player.name ?? "Guest";
    const options = mpMode === "x01" ? { start_score: 501, double_out: true } : {};
    rmRef.current?.startGame(mpMode, [me.name, opponent], options);
  }, [mpMode, peersForRole]);

  const role = selfId && peersForRole.length ? hostRole(selfId, peersForRole) : null;
```

(g) Add the match section to the `in_room` render. Insert this block between the "Peer list" `{peers.length === 0 && (...)}` block and `<MpControls onLeave={handleLeave} />` (around line 256):

```tsx
      {/* Shared match */}
      <div className="border-t border-neutral-800 pt-4">
        {gameState && gameState.status === "in_progress" ? (
          <LiveGame state={gameState} />
        ) : role === "host" ? (
          <div className="flex items-center gap-3">
            <label className="text-sm text-neutral-300">
              Mode
              <select
                value={mpMode}
                onChange={(e) => setMpMode(e.target.value)}
                aria-label="Match mode"
                className="ml-2 bg-neutral-800 rounded-lg px-3 py-2 text-sm"
              >
                <option value="x01">X01 (501)</option>
                <option value="cricket">Cricket</option>
                <option value="around_the_clock">Around the Clock</option>
              </select>
            </label>
            <button
              onClick={handleStartMatch}
              disabled={peersForRole.length === 0}
              className="px-4 py-2 rounded-lg bg-amber-400 text-neutral-900 font-bold text-sm hover:bg-amber-300 disabled:opacity-40"
              aria-label="Start match"
            >
              Start match
            </button>
          </div>
        ) : (
          <p className="text-neutral-500 text-sm">Waiting for the host to start the match…</p>
        )}
      </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix ui test -- views/Multiplayer`
Expected: PASS — existing 10 join-form tests + 3 new match-panel tests.

- [ ] **Step 5: Run the FULL UI suite + typecheck/build**

Run: `npm --prefix ui test`
Expected: PASS — 168 baseline + new tests (peerManager +1, remoteMatch +12, bridgeLink +4, Multiplayer +3 ≈ 188 total).

Run: `npm --prefix ui run build`
Expected: `tsc -b` clean (no type errors) + `vite build` succeeds. This proves the `Command`/`Event`/`PeerLike`/`BridgeLike` types line up across files.

- [ ] **Step 6: Commit**

```bash
git add ui/src/views/Multiplayer.tsx ui/src/views/Multiplayer.test.tsx
git commit -m "feat(mp): remote match UI — start panel, lifecycle, synced board (MP-3)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Docs — manual E2E checklist + build log

**Files:**
- Create: `docs/MANUAL-E2E-mp3.md`
- Modify: `docs/BUILD-LOG.md`

- [ ] **Step 1: Write the manual E2E checklist**

Create `docs/MANUAL-E2E-mp3.md`:

```markdown
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
```

- [ ] **Step 2: Update the build log**

Append to `docs/BUILD-LOG.md`:

```markdown

### MP-3 · Host-authoritative remote game sync ✅
Spec `docs/superpowers/specs/2026-05-22-mp3-remote-sync-design.md`; plan
`docs/superpowers/plans/2026-05-22-mp3-remote-sync.md`. Built subagent-driven on
`mp3-remote-sync`, merged to `main`.

- **Engine:** `on_dart(dart, source_player_id=None)` with an opt-in active-player
  gate; `set_remote_role()` + `attach()` tags local darts. Gate is INERT for local
  play (default role `None`) so single-board multiplayer is unchanged.
- **Commands:** `remote_dart {bed, player}` + `set_remote_role {player}`.
- **UI:** pure `RemoteMatch` orchestrator (host forwards `game_state`, routes peer
  darts to `remote_dart`; guest forwards `dart_hit`, renders pushed state),
  deterministic `hostRole()` election, `bridgeLink` pub/sub wiring the bridge WS to
  the Multiplayer view, `PeerManager.onChannelOpen` reconnect snapshots, and a
  "Start remote match" panel + synced board in the Multiplayer view.
- **Tests:** +7 Python (turn gate / alternating sequence / local regression),
  +20 UI (remoteMatch 12, bridgeLink 4, peerManager 1, Multiplayer 3).
- **Manual E2E:** `docs/MANUAL-E2E-mp3.md` (two bridges + two UIs — WebRTC needs real browsers).
- **Known MVP gaps:** guest-miss not auto-detected; only host has controls; 2-player.

**Next:** MP-4 profiles/avatars; quick parity modes (Count-Up, Medley); real app icons.
```

- [ ] **Step 3: Commit**

```bash
git add docs/MANUAL-E2E-mp3.md docs/BUILD-LOG.md
git commit -m "docs: MP-3 manual E2E checklist + build-log entry

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `.venv/Scripts/python.exe -m pytest -q` → 170 passed.
- [ ] `npm --prefix ui test` → all green (~188).
- [ ] `npm --prefix ui run build` → clean tsc + vite build.
- [ ] Skim `git log --oneline` on `mp3-remote-sync` — one focused commit per task.
- [ ] Then: review (opus), fast-forward merge to `main`, push; perform the manual E2E when two boards/instances are available.

---

## Self-Review (run against the spec)

**Spec coverage:**
- "Tag every dart with a source player id and gate by active player" → Task 2 `on_dart(source_player_id=...)` + gate. ✓
- "`on_dart(dart, source_player_id=None)`; ignore if set and != active" → Task 2 (and the local-play default `None` keeps existing behavior). ✓
- "`attach()` tags local darts with a configurable local player id" → Task 2 `attach()` passes `self._local_player_id`; **corrected** the spec's "default p1" to default `None` so local 2-player play isn't broken (documented in the plan header). ✓
- "`set_remote_role(local_player_id)` (or a `start_remote` command)" → Task 1 `SetRemoteRole` command + Task 2 `set_remote_role()` method. ✓
- "`commands.py`: add `RemoteDart {command, bed, player}`; `parse_command` handles it" → Task 1. ✓
- "`handle_command(RemoteDart)` → `on_dart(Dart.from_bed(bed), source_player_id=player)`" → Task 2. ✓
- "`remoteMatch.ts` orchestrates host/guest on top of PeerManager + bridge WS" → Task 4 `RemoteMatch`. ✓
- "Host: on `game_state` sendData state; on peer dart send `remote_dart`" → Task 4 host branch. ✓
- "Guest: on `dart_hit` sendData dart; on peer state push into store, suppress local engine" → Task 4 guest branch + Task 6 `applyState`; guest never sends `start_game` so its engine stays idle. ✓
- "Start remote match UI (host picks mode/options)" → Task 6 panel. ✓
- "Reuse existing boards/overlays to render synced game_state" → Task 6 renders `<LiveGame state={gameState} />`. ✓
- "On data-channel (re)open, host sends a full snapshot" → Task 3 `onChannelOpen` + Task 4 host re-send of `_lastState`. ✓
- "Unit (bridge): gate ignores non-active source; remote_dart for active scores; full alternating sequence" → Task 2 tests. ✓
- "Unit (UI): remoteMatch host/guest routing with fake PeerManager + fake bridge WS" → Task 4 tests. ✓
- "Manual E2E: two bridges + two UIs" → Task 7 `docs/MANUAL-E2E-mp3.md`. ✓
- Misses: spec allows "reuse record_miss semantics through the same gated path" — documented as an MVP limitation (host-driven) in Task 7 rather than built, keeping scope tight. ✓ (intentional deferral, flagged)

**Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N" — every code and test step contains complete content. ✓

**Type consistency:**
- Python: `RemoteDart.bed/player`, `SetRemoteRole.player: Optional[str]`, `on_dart(dart, source_player_id=None)`, `set_remote_role(local_player_id)`, `self._local_player_id` — names match across Tasks 1–2. ✓
- TS: `Command` adds `remote_dart {bed, player}` + `set_remote_role {player: string|null}` (Task 4) consumed by `RemoteMatch.startGame`/`stop`/`_onPeerMessage` and asserted in tests. `PeerLike` (sendData/onDataMessage/onChannelOpen) matches the real `PeerManager` after Task 3. `BridgeLike` (send/onEvent) matches `bridgeLink` (Task 5). `SyncMsg` `{t:"state"|"dart"}` is used identically on both send and receive sides. `hostRole(selfId, peers)` signature matches its callers in Task 6 and its tests in Task 4. ✓
- `applyState` pushes `{ type: "game_state", state }` — matches the `Event` union and `store.applyEvent`. ✓

No gaps found; plan is internally consistent and covers the spec.
