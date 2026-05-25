# MP-3 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four known MP-3 MVP gaps — host tab-switch teardown, no guest controls, no guest miss, no reconnect recovery — without changing the Python engine's scoring logic.

**Architecture:** Hoist the live multiplayer session (broker, PeerManager, RemoteMatch, media streams) out of the `Multiplayer` React view into a module-level `mpSession` singleton (mirroring `bridgeLink`), so tab switches can't tear it down. Add bounded ICE-restart reconnect to `PeerManager` with a `connectionHealth` signal. Add an explicit, host-validated, turn-gated guest→host request message (`{t:"req",…}`) so the guest can miss/undo/correct on their own turn and either side can rematch — the host stays the single scoring authority.

**Tech Stack:** React 18 + TypeScript + Zustand + Vite (`ui/`), Vitest for UI tests; Python 3 + pydantic engine (`src/granbridge/`), pytest.

> **Worktree:** All paths below are relative to the worktree root `C:\Users\willa\granbridge-wt-mp3` (branch `mp3-hardening`). Run every command from there. Do NOT operate in the shared dir `C:\Users\willa\granbridge` (a sibling agent owns it for `server-side-stats`).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `ui/src/multiplayer/store.ts` | Reactive MP render-state (status, peers, streams, health, opponent card) | Modify: add `localStream`, `remoteStreams`, `connectionHealth`, `opponentCard` + setters; clear in `resetMp` |
| `ui/src/multiplayer/session.ts` | The live session singleton (broker/PM/RM/streams); imperative API | **Create** |
| `ui/src/multiplayer/session.test.ts` | Session unit tests (mocked deps) | **Create** |
| `ui/src/views/Multiplayer.tsx` | Thin renderer + join form; calls `mpSession.*` | Modify: remove refs/effects/handlers; read store; add reconnect banner + guest controls |
| `ui/src/multiplayer/peerManager.ts` | WebRTC perfect-negotiation + **ICE-restart reconnect** | Modify: `onConnectionHealth` + bounded `restartIce` |
| `ui/src/multiplayer/peerManager.test.ts` | PeerManager tests | Modify: reconnect tests |
| `ui/src/multiplayer/remoteMatch.ts` | Sync orchestrator + **guest request gating** | Modify: `req` protocol, `requestAction`, host gating, `_lastStart` |
| `ui/src/multiplayer/remoteMatch.test.ts` | RemoteMatch tests | Modify: `req` tests |
| `ui/src/components/GuestControls.tsx` | Guest control bar (miss/undo/correct/rematch) | **Create** |
| `ui/src/components/GuestControls.test.tsx` | Guest control bar tests | **Create** |
| `tests/game/test_remote_sync.py` | Engine remote-gating regression | Modify: 2 host-gated-command tests |
| `docs/MANUAL-E2E-mp3.md` | Manual E2E runbook | Modify: 4 new checks |

**Baseline:** before starting, from the worktree root run `npm --prefix ui test` and `python -m pytest -q` to confirm green. Commit cadence: one commit per task.

---

## Task 1: Store — session render-state fields

**Files:**
- Modify: `ui/src/multiplayer/store.ts`

- [ ] **Step 1: Write the failing test** — append to `ui/src/multiplayer/store.test.ts` (create the file if it does not exist) :

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useMpStore } from "./store";

describe("useMpStore session fields", () => {
  beforeEach(() => useMpStore.getState().resetMp());

  it("defaults connectionHealth to 'connected' and streams empty", () => {
    const s = useMpStore.getState();
    expect(s.connectionHealth).toBe("connected");
    expect(s.localStream).toBeNull();
    expect(s.remoteStreams.size).toBe(0);
    expect(s.opponentCard).toBeNull();
  });

  it("setRemoteStream adds by peer id; resetMp clears everything", () => {
    const fake = {} as MediaStream;
    useMpStore.getState().setRemoteStream("peerA", fake);
    useMpStore.getState().setConnectionHealth("reconnecting");
    expect(useMpStore.getState().remoteStreams.get("peerA")).toBe(fake);
    useMpStore.getState().resetMp();
    expect(useMpStore.getState().remoteStreams.size).toBe(0);
    expect(useMpStore.getState().connectionHealth).toBe("connected");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npm --prefix ui test -- run src/multiplayer/store.test.ts` → fails (`connectionHealth` undefined / `setRemoteStream` not a function).

- [ ] **Step 3: Implement** in `ui/src/multiplayer/store.ts`:
  - Add a type near `MpStatus`: `export type ConnectionHealth = "connected" | "reconnecting" | "lost";`
  - Add to `interface MpState` (after `brokerUrl`):
    ```ts
      localStream: MediaStream | null;
      remoteStreams: Map<string, MediaStream>;
      connectionHealth: ConnectionHealth;
      opponentCard: { profile: import("./player").Profile; summary: import("./careerSummary").CareerSummary } | null;
      setLocalStream: (s: MediaStream | null) => void;
      setRemoteStream: (peerId: string, s: MediaStream) => void;
      setConnectionHealth: (h: ConnectionHealth) => void;
      setOpponentCard: (c: MpState["opponentCard"]) => void;
    ```
  - Add to the `create<MpState>` initial object:
    ```ts
      localStream: null,
      remoteStreams: new Map(),
      connectionHealth: "connected",
      opponentCard: null,
      setLocalStream: (s) => set({ localStream: s }),
      setRemoteStream: (peerId, s) => set((st) => ({ remoteStreams: new Map(st.remoteStreams).set(peerId, s) })),
      setConnectionHealth: (h) => set({ connectionHealth: h }),
      setOpponentCard: (c) => set({ opponentCard: c }),
    ```
  - In `resetMp`, extend the `set({…})` to also clear: `localStream: null, remoteStreams: new Map(), connectionHealth: "connected", opponentCard: null`.

- [ ] **Step 4: Run it, expect PASS** — `npm --prefix ui test -- run src/multiplayer/store.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add ui/src/multiplayer/store.ts ui/src/multiplayer/store.test.ts
git commit -m "feat(ui): MP store fields for hoisted session (streams, connectionHealth, opponentCard)"
```

---

## Task 2: `mpSession` singleton (join / leave / startMatch)

**Files:**
- Create: `ui/src/multiplayer/session.ts`
- Create: `ui/src/multiplayer/session.test.ts`

- [ ] **Step 1: Write the failing test** — `ui/src/multiplayer/session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock heavy deps so the session can be driven without WebRTC/media.
const joinFn = vi.fn();
const onJoinedCbs: Array<(self: any, peers: any[]) => void> = [];
vi.mock("./brokerClient", () => ({
  BrokerClient: class {
    constructor(public url: string) {}
    onJoined(cb: any) { onJoinedCbs.push(cb); return this; }
    onPeers() { return this; } onError() { return this; } onClose() { return this; }
    connect() {} join(...a: any[]) { joinFn(...a); } leave() {} close() {}
  },
}));
const rmStart = vi.fn(); const rmStop = vi.fn(); const rmStartGame = vi.fn();
vi.mock("./peerManager", () => ({ PeerManager: class { onRemoteStream:any=()=>{}; onConnectionHealth:any=()=>{}; closeAll(){} } }));
vi.mock("./remoteMatch", async (orig) => {
  const actual = await orig<any>();
  return { ...actual, RemoteMatch: class { start = rmStart; stop = rmStop; startGame = rmStartGame; } };
});
vi.mock("./media", () => ({ getLocalStream: vi.fn(async () => null) }));
vi.mock("./turn", () => ({ fetchIceServers: vi.fn(async () => []) }));
vi.mock("./careerSummary", () => ({ fetchMyCareerSummary: vi.fn(async () => ({ threeDartAvg: 0, wins: 0, gamesPlayed: 0 })) }));

import { mpSession } from "./session";
import { useMpStore } from "./store";

beforeEach(() => { useMpStore.getState().resetMp(); onJoinedCbs.length = 0; joinFn.mockClear(); rmStart.mockClear(); rmStop.mockClear(); });

const JOIN = { room: "r", password: "p", displayName: "Me", brokerUrl: "ws://x" };

describe("mpSession", () => {
  it("join → broker.join called and status connecting", async () => {
    await mpSession.join(JOIN);
    expect(joinFn).toHaveBeenCalledTimes(1);
    expect(["connecting", "in_room"]).toContain(useMpStore.getState().mpStatus);
  });

  it("onJoined with a peer sets in_room and starts a RemoteMatch", async () => {
    await mpSession.join(JOIN);
    onJoinedCbs[0]({ peer_id: "aaa", player: { id: "p", name: "n" } },
                   [{ peer_id: "zzz", player: { id: "p2", name: "G" } }]);
    expect(useMpStore.getState().mpStatus).toBe("in_room");
    expect(rmStart).toHaveBeenCalled();
  });

  it("join is idempotent while connecting/in_room", async () => {
    await mpSession.join(JOIN);
    joinFn.mockClear();
    await mpSession.join(JOIN);
    expect(joinFn).not.toHaveBeenCalled();
  });

  it("leave stops the match and resets the store", async () => {
    await mpSession.join(JOIN);
    onJoinedCbs[0]({ peer_id: "aaa", player: { id: "p", name: "n" } }, [{ peer_id: "zzz", player: { id: "p2", name: "G" } }]);
    mpSession.leave();
    expect(rmStop).toHaveBeenCalled();
    expect(useMpStore.getState().mpStatus).toBe("idle");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npm --prefix ui test -- run src/multiplayer/session.test.ts` → fails (`./session` not found).

- [ ] **Step 3: Implement** `ui/src/multiplayer/session.ts`:

```ts
/**
 * mpSession — the live multiplayer session, owned at module scope (like bridgeLink)
 * so it survives React view unmounts (tab switches). Holds the BrokerClient,
 * PeerManager and RemoteMatch; pushes reactive state into useMpStore.
 */
import { useMpStore } from "./store";
import { getOrCreatePlayer, setPlayerName } from "./player";
import { BrokerClient, type PeerInfo } from "./brokerClient";
import { PeerManager } from "./peerManager";
import { getLocalStream } from "./media";
import { fetchIceServers } from "./turn";
import { fetchMyCareerSummary } from "./careerSummary";
import { RemoteMatch, hostRole, type GuestAction } from "./remoteMatch";
import { bridgeLink } from "../bridgeLink";
import { useStore } from "../store";
import type { Profile } from "./player";
import type { CareerSummary } from "./careerSummary";

export interface JoinOpts { room: string; password: string; displayName: string; brokerUrl: string; }

class MpSession {
  private broker: BrokerClient | null = null;
  private pm: PeerManager | null = null;
  private rm: RemoteMatch | null = null;
  private selfCard: { profile: Profile; summary: CareerSummary } | null = null;

  async join(opts: JoinOpts): Promise<void> {
    const store = useMpStore.getState();
    if (store.mpStatus === "connecting" || store.mpStatus === "in_room") return; // idempotent
    store.setError(undefined);
    store.setMpStatus("connecting");
    store.setRoom(opts.room);

    const { mic, cam } = useMpStore.getState();
    const player = setPlayerName(opts.displayName.trim() || getOrCreatePlayer().name);
    if (opts.brokerUrl.trim()) store.setBrokerUrl(opts.brokerUrl.trim());

    const stream = await getLocalStream({ video: cam, audio: mic });
    useMpStore.getState().setLocalStream(stream);

    this.selfCard = { profile: player, summary: await fetchMyCareerSummary(player.name) };

    const url = opts.brokerUrl.trim() || useMpStore.getState().brokerUrl;
    const iceServers = await fetchIceServers(url);

    const bc = new BrokerClient(url);
    this.broker = bc;

    bc.onJoined((self: PeerInfo, initialPeers: PeerInfo[]) => {
      const s = useMpStore.getState();
      s.setSelfId(self.peer_id);
      s.setPeers(initialPeers);
      s.setMpStatus("in_room");

      const pm = new PeerManager(bc, self.peer_id, stream, iceServers);
      this.pm = pm;
      pm.onRemoteStream = (peerId, rs) => useMpStore.getState().setRemoteStream(peerId, rs);
      pm.onConnectionHealth = (_peerId, health) => useMpStore.getState().setConnectionHealth(health);
      this.ensureRemoteMatch();
    });

    bc.onPeers((latest: PeerInfo[]) => { useMpStore.getState().setPeers(latest); this.ensureRemoteMatch(); });
    bc.onError((code, message) => { const s = useMpStore.getState(); s.setError(`${code}: ${message}`); s.setMpStatus("error"); });
    bc.onClose(() => { const s = useMpStore.getState(); if (s.mpStatus === "in_room") { s.setMpStatus("error"); s.setError("Disconnected from broker"); } });

    bc.connect();
    bc.join(opts.room, opts.password, { id: player.id, name: player.name, avatar: player.avatar });
  }

  private ensureRemoteMatch(): void {
    const { peers, selfId } = useMpStore.getState();
    if (this.rm || !this.pm || !selfId || peers.length === 0) return;
    const rm = new RemoteMatch({
      role: hostRole(selfId, peers),
      peer: this.pm,
      bridge: bridgeLink,
      applyState: (state) => useStore.getState().applyEvent({ type: "game_state", state }),
      selfCard: this.selfCard,
      onOpponentCard: (profile, summary) => useMpStore.getState().setOpponentCard({ profile, summary }),
    });
    rm.start();
    this.rm = rm;
  }

  startMatch(mode: string, options: Record<string, unknown>): void {
    if (!this.rm) return;
    const me = getOrCreatePlayer();
    const opponent = useMpStore.getState().peers[0]?.player.name ?? "Guest";
    this.rm.startGame(mode, [me.name, opponent], options);
  }

  requestAction(action: GuestAction, bed?: string): void { this.rm?.requestAction(action, bed); }

  leave(): void {
    this.broker?.leave(); this.broker?.close(); this.broker = null;
    this.pm?.closeAll(); this.pm = null;
    this.rm?.stop(); this.rm = null;
    this.selfCard = null;
    useMpStore.getState().localStream?.getTracks().forEach((t) => t.stop());
    useMpStore.getState().resetMp();
  }
}

export const mpSession = new MpSession();
```

> Note: `requestAction` / `GuestAction` reference members added in Task 7. Until then TypeScript will error on the import. If building A-cluster in isolation, temporarily type `action: string` and drop the import; Task 7 restores the real type. (Simplest: do Tasks 2 and 7 before the next `npm --prefix ui run build`.)

- [ ] **Step 4: Run it, expect PASS** — `npm --prefix ui test -- run src/multiplayer/session.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add ui/src/multiplayer/session.ts ui/src/multiplayer/session.test.ts
git commit -m "feat(ui): mpSession singleton owning broker/peer/remote-match (survives tab switch)"
```

---

## Task 3: Refactor `Multiplayer.tsx` to use `mpSession`

**Files:**
- Modify: `ui/src/views/Multiplayer.tsx`

- [ ] **Step 1: Edit the view.** Make these exact changes:
  - **Delete** the refs `brokerRef`, `pmRef`, `rmRef`, `selfCardRef` (`:63-66`).
  - **Delete** the remote-match init effect (`:77-90`), the unmount-teardown effect (`:98-101`), and the opponent-card-clear effect (`:104-106`).
  - **Delete** local state `opponentCard`/`setOpponentCard` (`:56`); instead read it from the store.
  - Add store reads near the other `useMpStore` selectors:
    ```ts
    const localStream = useMpStore((s) => s.localStream);
    const remoteStreams = useMpStore((s) => s.remoteStreams);
    const connectionHealth = useMpStore((s) => s.connectionHealth);
    const opponentCard = useMpStore((s) => s.opponentCard);
    ```
  - **Delete** local `localStream`/`remoteStreams` `useState` (`:59-60`).
  - Replace `handleJoin` body with:
    ```ts
    const handleJoin = useCallback(() => {
      if (!roomInput.trim() || !passwordInput.trim()) return;
      void mpSession.join({ room: roomInput.trim(), password: passwordInput.trim(),
        displayName: displayName.trim() || identity.name, brokerUrl: brokerInput.trim() });
    }, [roomInput, passwordInput, displayName, brokerInput, identity.name]);
    ```
  - Replace `handleLeave` body with: `const handleLeave = useCallback(() => mpSession.leave(), []);`
  - Replace `handleStartMatch` body with:
    ```ts
    const handleStartMatch = useCallback(() => {
      const options = mpMode === "x01" ? { start_score: 501, double_out: true } : {};
      mpSession.startMatch(mpMode, options);
    }, [mpMode]);
    ```
  - Add the import: `import { mpSession } from "../multiplayer/session";`
  - Keep the mic/cam → `track.enabled` effect but read `localStream` from the store (already done by the new selector).
  - Add a reconnect banner inside the `in_room` return, just under the room header:
    ```tsx
    {connectionHealth === "reconnecting" && (
      <div role="status" className="bg-amber-900/50 border border-amber-700 rounded-lg px-4 py-2 text-sm text-amber-200">
        Reconnecting…
      </div>
    )}
    {connectionHealth === "lost" && (
      <div role="alert" className="bg-red-900/60 border border-red-700 rounded-lg px-4 py-2 text-sm text-red-200">
        Connection lost. <button onClick={handleJoin} className="underline">Rejoin</button>
      </div>
    )}
    ```

- [ ] **Step 2: Typecheck + full UI suite** — `npm --prefix ui run build` then `npm --prefix ui test`. Expected: build clean; the existing `Multiplayer.test.tsx` still passes (it renders the idle form and a guarded in_room view; the join form and tiles are unchanged). If a test asserted on the deleted refs/handlers internals, update it to call `mpSession` (it should only assert rendered output, so likely no change).

- [ ] **Step 3: Commit**
```bash
git add ui/src/views/Multiplayer.tsx
git commit -m "refactor(ui): Multiplayer view reads store + drives mpSession; reconnect banner"
```

---

## Task 4: `PeerManager` ICE-restart reconnect

**Files:**
- Modify: `ui/src/multiplayer/peerManager.ts`
- Modify: `ui/src/multiplayer/peerManager.test.ts`

- [ ] **Step 1: Write the failing tests** — add to `peerManager.test.ts`. First extend `FakePC` (add inside the class): `restartIceCalls = 0; restartIce() { this.restartIceCalls++; }`. Then append:

```ts
describe("PeerManager reconnect", () => {
  it("schedules an ICE restart after disconnect/failed", () => {
    vi.useFakeTimers();
    const broker = makeMockBroker() as unknown as BrokerClient;
    new PeerManager(broker, "zzz", null);
    (broker as any)._emitPeers([{ peer_id: "aaa", player: { id: "p1", name: "A" } }]);
    const pc = FakePC.instances[0];
    pc.connectionState = "failed";
    pc.onconnectionstatechange?.();
    vi.advanceTimersByTime(1000);
    expect(pc.restartIceCalls).toBe(1);
    vi.useRealTimers();
  });

  it("emits health: reconnecting then connected", () => {
    const broker = makeMockBroker() as unknown as BrokerClient;
    const pm = new PeerManager(broker, "zzz", null);
    const health: string[] = [];
    pm.onConnectionHealth = (_id, h) => health.push(h);
    (broker as any)._emitPeers([{ peer_id: "aaa", player: { id: "p1", name: "A" } }]);
    const pc = FakePC.instances[0];
    pc.connectionState = "disconnected"; pc.onconnectionstatechange?.();
    pc.connectionState = "connected"; pc.onconnectionstatechange?.();
    expect(health).toEqual(["reconnecting", "connected"]);
  });

  it("gives up as 'lost' after MAX restarts", () => {
    vi.useFakeTimers();
    const broker = makeMockBroker() as unknown as BrokerClient;
    const pm = new PeerManager(broker, "zzz", null);
    const health: string[] = [];
    pm.onConnectionHealth = (_id, h) => health.push(h);
    (broker as any)._emitPeers([{ peer_id: "aaa", player: { id: "p1", name: "A" } }]);
    const pc = FakePC.instances[0];
    for (let i = 0; i < 4; i++) { pc.connectionState = "failed"; pc.onconnectionstatechange?.(); vi.advanceTimersByTime(5000); }
    expect(health).toContain("lost");
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npm --prefix ui test -- run src/multiplayer/peerManager.test.ts` (no `onConnectionHealth`, no restart).

- [ ] **Step 3: Implement** in `peerManager.ts`:
  - Add a public callback near the others (`:52`): `onConnectionHealth: (peerId: string, health: "connected" | "reconnecting" | "lost") => void = () => {};`
  - Add fields on the class: `private _retries = new Map<string, number>();` and `private static MAX_ICE_RESTARTS = 3;`
  - Replace the `onconnectionstatechange` handler (`:159-162`) with:
    ```ts
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState as PeerState;
      this.onPeerState(peerId, state);
      if (state === "connected") { this._retries.set(peerId, 0); this.onConnectionHealth(peerId, "connected"); }
      else if (state === "disconnected" || state === "failed") { this._attemptRestart(peerId); }
    };
    ```
  - Add the method:
    ```ts
    private _attemptRestart(peerId: string) {
      const entry = this._peers.get(peerId);
      if (!entry) return;
      const n = this._retries.get(peerId) ?? 0;
      if (n >= PeerManager.MAX_ICE_RESTARTS) { this.onConnectionHealth(peerId, "lost"); return; }
      this._retries.set(peerId, n + 1);
      this.onConnectionHealth(peerId, "reconnecting");
      const delay = [1000, 2000, 4000][n] ?? 4000;
      setTimeout(() => {
        const e = this._peers.get(peerId);
        if (!e || e.pc.connectionState === "connected") return;
        if (typeof e.pc.restartIce === "function") e.pc.restartIce();
      }, delay);
    }
    ```

- [ ] **Step 4: Run, expect PASS** — `npm --prefix ui test -- run src/multiplayer/peerManager.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add ui/src/multiplayer/peerManager.ts ui/src/multiplayer/peerManager.test.ts
git commit -m "feat(ui): PeerManager bounded ICE-restart reconnect + connectionHealth signal"
```

---

## Task 5: `remoteMatch` — guest request protocol + host gating

**Files:**
- Modify: `ui/src/multiplayer/remoteMatch.ts`
- Modify: `ui/src/multiplayer/remoteMatch.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `remoteMatch.test.ts`. Add a visit-dart constant near `DART`: `const VDART = { bed: "S1", ring: "SI", segment: 1, multiplier: 1, score: 1 };` Then:

```ts
describe("RemoteMatch guest requests (host side)", () => {
  const hostRM = () => { const peer = fakePeer(); const bridge = fakeBridge();
    const rm = new RemoteMatch({ role: "host", peer, bridge, applyState: () => {} }); rm.start(); return { peer, bridge, rm }; };

  it("miss on the guest's turn → record_miss", () => {
    const { peer, bridge } = hostRM();
    bridge.fireEvent({ type: "game_state", state: { ...STATE, active_index: 1 } }); // p2 active
    bridge.sent.length = 0;
    peer.fireData({ t: "req", action: "miss" });
    expect(bridge.sent).toEqual([{ command: "record_miss" }]);
  });

  it("miss on the host's turn is ignored", () => {
    const { peer, bridge } = hostRM();
    bridge.fireEvent({ type: "game_state", state: { ...STATE, active_index: 0 } });
    bridge.sent.length = 0;
    peer.fireData({ t: "req", action: "miss" });
    expect(bridge.sent).toEqual([]);
  });

  it("undo ignored when the guest's visit is empty", () => {
    const { peer, bridge } = hostRM();
    bridge.fireEvent({ type: "game_state", state: { ...STATE, active_index: 1, visit: [] } });
    bridge.sent.length = 0;
    peer.fireData({ t: "req", action: "undo" });
    expect(bridge.sent).toEqual([]);
  });

  it("undo on the guest's turn with a thrown dart → undo", () => {
    const { peer, bridge } = hostRM();
    bridge.fireEvent({ type: "game_state", state: { ...STATE, active_index: 1, visit: [VDART] } });
    bridge.sent.length = 0;
    peer.fireData({ t: "req", action: "undo" });
    expect(bridge.sent).toEqual([{ command: "undo" }]);
  });

  it("correct on the guest's turn → correct_last with the bed", () => {
    const { peer, bridge } = hostRM();
    bridge.fireEvent({ type: "game_state", state: { ...STATE, active_index: 1, visit: [VDART] } });
    bridge.sent.length = 0;
    peer.fireData({ t: "req", action: "correct", bed: "T20" });
    expect(bridge.sent).toEqual([{ command: "correct_last", bed: "T20" }]);
  });

  it("rematch after a finished game → start_game with the last settings", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const rm = new RemoteMatch({ role: "host", peer, bridge, applyState: () => {} }); rm.start();
    rm.startGame("x01", ["H", "G"], { start_score: 501 });
    bridge.fireEvent({ type: "game_state", state: { ...STATE, status: "finished" } });
    bridge.sent.length = 0;
    peer.fireData({ t: "req", action: "rematch" });
    expect(bridge.sent).toEqual([{ command: "start_game", mode: "x01", players: ["H", "G"], options: { start_score: 501 } }]);
  });

  it("rematch ignored while a game is in progress", () => {
    const { peer, bridge, rm } = hostRM();
    rm.startGame("x01", ["H", "G"], {});
    bridge.fireEvent({ type: "game_state", state: { ...STATE, status: "in_progress" } });
    bridge.sent.length = 0;
    peer.fireData({ t: "req", action: "rematch" });
    expect(bridge.sent).toEqual([]);
  });

  it("ignores a malformed req (bad action, or correct without a bed)", () => {
    const { peer, bridge } = hostRM();
    bridge.fireEvent({ type: "game_state", state: { ...STATE, active_index: 1, visit: [VDART] } });
    bridge.sent.length = 0;
    peer.fireData({ t: "req", action: "explode" });
    peer.fireData({ t: "req", action: "correct" });
    expect(bridge.sent).toEqual([]);
  });
});

describe("RemoteMatch guest requests (guest side)", () => {
  it("requestAction sends a req over the data channel", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const rm = new RemoteMatch({ role: "guest", peer, bridge, applyState: () => {} }); rm.start();
    rm.requestAction("miss");
    rm.requestAction("correct", "T20");
    expect(peer.sent).toEqual([{ t: "req", action: "miss" }, { t: "req", action: "correct", bed: "T20" }]);
  });

  it("host requestAction is a no-op", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const rm = new RemoteMatch({ role: "host", peer, bridge, applyState: () => {} }); rm.start();
    rm.requestAction("miss");
    expect(peer.sent).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npm --prefix ui test -- run src/multiplayer/remoteMatch.test.ts`.

- [ ] **Step 3: Implement** in `remoteMatch.ts`:
  - Add the exported type and extend `SyncMsg`:
    ```ts
    export type GuestAction = "miss" | "undo" | "correct" | "rematch";
    ```
    Add this member to the `SyncMsg` union: `| { t: "req"; action: GuestAction; bed?: string }`.
  - Extend `isSyncMsg` (before `return false;`):
    ```ts
    if (t === "req") {
      const action = (o as { action?: unknown }).action;
      if (action !== "miss" && action !== "undo" && action !== "correct" && action !== "rematch") return false;
      if (action === "correct" && typeof (o as { bed?: unknown }).bed !== "string") return false;
      return true;
    }
    ```
  - Add a field to the class: `private _lastStart: { mode: string; players: string[]; options: Record<string, unknown> } | null = null;`
  - In `startGame`, before the `bridge.send` calls, record: `this._lastStart = { mode, players, options };`
  - Add the guest method (public):
    ```ts
    requestAction(action: GuestAction, bed?: string): void {
      if (this._opts.role !== "guest") return;
      this._opts.peer.sendData(bed === undefined ? { t: "req", action } : { t: "req", action, bed });
    }
    ```
  - In `_onPeerMessage`, in the `if (role === "host")` branch, after the `if (msg.t === "dart") {…}`, add `else if (msg.t === "req") { this._handleGuestRequest(msg); }`.
  - Add the handler:
    ```ts
    private _handleGuestRequest(msg: { t: "req"; action: GuestAction; bed?: string }): void {
      const st = this._lastState;
      if (!st) return;
      const activeId = st.players[st.active_index]?.id;
      const guestTurn = activeId === this._opts.guestSlot;
      const { bridge } = this._opts;
      switch (msg.action) {
        case "miss": if (guestTurn) bridge.send({ command: "record_miss" }); break;
        case "undo": if (guestTurn && st.visit.length > 0) bridge.send({ command: "undo" }); break;
        case "correct": if (guestTurn && st.visit.length > 0 && typeof msg.bed === "string") bridge.send({ command: "correct_last", bed: msg.bed }); break;
        case "rematch": if (st.status === "finished" && this._lastStart) bridge.send({ command: "start_game", mode: this._lastStart.mode, players: this._lastStart.players, options: this._lastStart.options }); break;
      }
    }
    ```

- [ ] **Step 4: Run, expect PASS** — `npm --prefix ui test -- run src/multiplayer/remoteMatch.test.ts`. Then `npm --prefix ui run build` (this restores type-soundness of `mpSession.requestAction` from Task 2).

- [ ] **Step 5: Commit**
```bash
git add ui/src/multiplayer/remoteMatch.ts ui/src/multiplayer/remoteMatch.test.ts
git commit -m "feat(ui): guest request protocol — host-validated, turn-gated miss/undo/correct/rematch"
```

---

## Task 6: `GuestControls` component

**Files:**
- Create: `ui/src/components/GuestControls.tsx`
- Create: `ui/src/components/GuestControls.test.tsx`

- [ ] **Step 1: Write the failing test** — `ui/src/components/GuestControls.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GuestControls } from "./GuestControls";
import type { GameState } from "../types";

const base: GameState = {
  mode: "x01", status: "in_progress",
  players: [{ id: "p1", name: "H" }, { id: "p2", name: "G" }],
  active_index: 1, visit: [], legs: {}, sets: {}, winner: null, options: {}, mode_view: {}, stats: {},
};

describe("GuestControls", () => {
  const onAction = vi.fn();
  beforeEach(() => onAction.mockClear());

  it("Miss requests a miss on the guest's turn", () => {
    render(<GuestControls state={base} guestSlot="p2" onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: /miss/i }));
    expect(onAction).toHaveBeenCalledWith("miss", undefined);
  });

  it("disables Miss/Undo when it is not the guest's turn", () => {
    render(<GuestControls state={{ ...base, active_index: 0 }} guestSlot="p2" onAction={onAction} />);
    expect(screen.getByRole("button", { name: /miss/i })).toBeDisabled();
  });

  it("Correct sends the typed bed", () => {
    render(<GuestControls state={{ ...base, visit: [{ bed: "S1", ring: "SI", segment: 1, multiplier: 1, score: 1 }] }} guestSlot="p2" onAction={onAction} />);
    fireEvent.change(screen.getByLabelText(/bed/i), { target: { value: "t20" } });
    fireEvent.click(screen.getByRole("button", { name: /correct/i }));
    expect(onAction).toHaveBeenCalledWith("correct", "T20");
  });

  it("shows only Rematch when the game is finished", () => {
    render(<GuestControls state={{ ...base, status: "finished" }} guestSlot="p2" onAction={onAction} />);
    expect(screen.queryByRole("button", { name: /^miss$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /rematch/i }));
    expect(onAction).toHaveBeenCalledWith("rematch", undefined);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npm --prefix ui test -- run src/components/GuestControls.test.tsx`.

- [ ] **Step 3: Implement** `ui/src/components/GuestControls.tsx`:

```tsx
import { useState } from "react";
import type { GameState } from "../types";
import type { GuestAction } from "../multiplayer/remoteMatch";

export function GuestControls({ state, guestSlot, onAction }: {
  state: GameState; guestSlot: string; onAction: (action: GuestAction, bed?: string) => void;
}) {
  const [bed, setBed] = useState("");
  const myTurn = state.players[state.active_index]?.id === guestSlot;
  const hasThrow = state.visit.length > 0;

  if (state.status === "finished") {
    return (
      <div className="flex gap-2">
        <button onClick={() => onAction("rematch", undefined)}
          className="px-4 py-2 rounded-lg bg-amber-400 text-neutral-900 font-bold text-sm hover:bg-amber-300">
          Rematch
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => onAction("miss", undefined)} disabled={!myTurn}
        className="px-3 py-2 rounded-lg bg-neutral-800 text-sm hover:bg-neutral-700 disabled:opacity-40">Miss</button>
      <button onClick={() => onAction("undo", undefined)} disabled={!myTurn || !hasThrow}
        className="px-3 py-2 rounded-lg bg-neutral-800 text-sm hover:bg-neutral-700 disabled:opacity-40">Undo</button>
      <input aria-label="Correct bed" value={bed} onChange={(e) => setBed(e.target.value)}
        placeholder="T20" className="w-20 bg-neutral-800 rounded-lg px-2 py-2 text-sm font-mono" />
      <button onClick={() => { if (bed.trim()) { onAction("correct", bed.trim().toUpperCase()); setBed(""); } }}
        disabled={!myTurn || !hasThrow}
        className="px-3 py-2 rounded-lg bg-neutral-800 text-sm hover:bg-neutral-700 disabled:opacity-40">Correct</button>
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS** — `npm --prefix ui test -- run src/components/GuestControls.test.tsx`.

- [ ] **Step 5: Commit**
```bash
git add ui/src/components/GuestControls.tsx ui/src/components/GuestControls.test.tsx
git commit -m "feat(ui): GuestControls bar — miss/undo/correct (turn-gated) + rematch"
```

---

## Task 7: Wire `GuestControls` into the Multiplayer view

**Files:**
- Modify: `ui/src/views/Multiplayer.tsx`

- [ ] **Step 1: Implement.** In the "Shared match" block (`:336-368`), in the guest path, render the controls when a game exists. Replace the guest-side `else` (currently the "Waiting for the host…" paragraph) so that:
  - When `gameState` exists (any status), render `<GuestControls state={gameState} guestSlot="p2" onAction={(a, bed) => mpSession.requestAction(a, bed)} />`.
  - When no `gameState` yet, keep the "Waiting for the host to start the match…" paragraph.
  ```tsx
  ) : role === "guest" && gameState ? (
    <GuestControls state={gameState} guestSlot="p2" onAction={(a, bed) => mpSession.requestAction(a, bed)} />
  ) : (
    <p className="text-neutral-500 text-sm">Waiting for the host to start the match…</p>
  )}
  ```
  Add the import: `import { GuestControls } from "../components/GuestControls";`
  > `guestSlot` is `"p2"` to match `RemoteMatch`'s default (host=p1, guest=p2).

- [ ] **Step 2: Typecheck + full suite** — `npm --prefix ui run build` then `npm --prefix ui test`. Expected: clean build, all green.

- [ ] **Step 3: Commit**
```bash
git add ui/src/views/Multiplayer.tsx
git commit -m "feat(ui): show GuestControls for the guest during/after a remote match"
```

---

## Task 8: Python regression — host-gated commands hit the active guest slot

**Files:**
- Modify: `tests/game/test_remote_sync.py`

- [ ] **Step 1: Write the failing tests** — append to `tests/game/test_remote_sync.py` (add `RecordMiss, CorrectLast` to the existing commands import on line 3):

```python
from granbridge.game.commands import StartGame, RemoteDart, SetRemoteRole, RecordMiss, CorrectLast


def test_host_gated_record_miss_applies_to_active_guest():
    eng = _engine(); _start_remote(eng, start_score=501)
    for _ in range(3):                                       # advance to p2 (guest)
        eng.on_dart(Dart.from_bed("S1"), source_player_id="p1")
    assert eng.state.active_index == 1
    eng.handle_command(RecordMiss(command="record_miss"))    # host forwards the guest's miss
    assert eng.state.stats["p2"].darts == 1                  # counted for the guest
    assert eng.state.mode_view["scores"]["p2"] == 501        # a miss scores 0


def test_host_gated_correct_last_applies_to_active_guest():
    eng = _engine(); _start_remote(eng, start_score=501)
    for _ in range(3):
        eng.on_dart(Dart.from_bed("S1"), source_player_id="p1")
    assert eng.state.active_index == 1
    eng.handle_command(RemoteDart(command="remote_dart", bed="S5", player="p2"))  # guest throws S5
    assert eng.state.mode_view["scores"]["p2"] == 501 - 5
    eng.handle_command(CorrectLast(command="correct_last", bed="T20"))            # host forwards guest's correction
    assert eng.state.mode_view["scores"]["p2"] == 501 - 60
```

- [ ] **Step 2: Run, expect PASS immediately** (no engine change needed — this LOCKS existing behavior): `python -m pytest tests/game/test_remote_sync.py -v`. If either fails, the engine has regressed the host-gated contract — fix the engine, not the test.

- [ ] **Step 3: Commit**
```bash
git add tests/game/test_remote_sync.py
git commit -m "test(game): lock host-gated record_miss/correct_last apply to the active guest slot"
```

---

## Task 9: Manual E2E runbook additions

**Files:**
- Modify: `docs/MANUAL-E2E-mp3.md`

- [ ] **Step 1: Implement.** Replace the "Known MVP limitations" section (`:32-40`) with a "## Hardening checks (MP-3 hardening)" section:

```markdown
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
```

- [ ] **Step 2: Commit**
```bash
git add docs/MANUAL-E2E-mp3.md
git commit -m "docs: MP-3 hardening manual E2E checks (tab-switch, guest controls, reconnect)"
```

---

## Final verification

- [ ] From the worktree root: `npm --prefix ui test` (all green) and `npm --prefix ui run build` (clean).
- [ ] `python -m pytest -q` (all green).
- [ ] Skim `docs/MANUAL-E2E-mp3.md` checks 12–16 for the next live 2-player session.

## Integration (per parallel-agent guidance)
Do NOT merge to `main` locally (that needs a `main` checkout in the shared dir and would yank a sibling). Instead push the branch and open a PR:
```bash
git push -u origin mp3-hardening
gh pr create --title "MP-3 hardening: session hoist, reconnect, guest controls" --fill
```
Then remove the worktree when done: `git worktree remove "$HOME/granbridge-wt-mp3"` (from the shared repo; on Windows, if the dir stays locked, delete it manually after).

---

## Self-Review

**Spec coverage:**
- A.1 session hoist → Tasks 1–3. ✅
- A.2 reconnect (ICE-restart + connectionHealth + banner) → Task 4 + Task 3 banner. ✅
- B protocol `req` + host gating → Task 5. ✅
- B guest control bar → Tasks 6–7. ✅
- B engine no-change + regression test → Task 8. ✅
- E2E doc → Task 9. ✅
- Non-goals (2-player, no buffering, no broker auto-reconnect) → respected; documented in Task 9. ✅

**Placeholder scan:** No TBD/TODO; every code step has concrete code and a runnable command. ✅

**Type consistency:** `GuestAction` defined in Task 5 (`remoteMatch.ts`), imported by `session.ts` (Task 2 note) and `GuestControls.tsx` (Task 6). `connectionHealth` union identical in store (Task 1), PeerManager callback (Task 4), and view (Task 3). `guestSlot="p2"` matches `RemoteMatch` default. `setRemoteStream(peerId, stream)` signature consistent between Task 1 (store) and Task 2 (session). Cross-task dependency called out: build Tasks 2 + 5 before the first full `npm --prefix ui run build`. ✅
