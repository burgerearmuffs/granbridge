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
