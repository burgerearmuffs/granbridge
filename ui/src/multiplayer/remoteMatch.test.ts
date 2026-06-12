import { describe, it, expect, vi } from "vitest";
import { RemoteMatch, hostRole } from "./remoteMatch";
import type { BridgeLike, PeerLike } from "./remoteMatch";
import type { Command, Event, GameState } from "../types";
import type { Profile } from "./player";
import type { CareerSummary } from "./careerSummary";

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
const VDART = { bed: "S1", ring: "SI", segment: 1, multiplier: 1, score: 1 };

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

  it("stop() clears the engine role on the bridge (explicit leave)", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const rm = new RemoteMatch({ role: "host", peer, bridge, applyState: () => {} });
    rm.start();
    bridge.sent.length = 0;
    rm.stop();
    expect(bridge.sent).toEqual([{ command: "set_remote_role", player: null }]);
  });

  it("stop(false) preserves the engine role (transient unmount / tab switch)", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const rm = new RemoteMatch({ role: "host", peer, bridge, applyState: () => {} });
    rm.start();
    bridge.sent.length = 0;
    rm.stop(false);
    expect(bridge.sent).toEqual([]);
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

const PROFILE: Profile = { id: "id-h", name: "Host", avatar: { color: "#f59e0b" }, writeToken: "tok" };
// Wire-safe profile — writeToken is intentionally stripped before sending over the data channel.
const WIRE_PROFILE = { id: PROFILE.id, name: PROFILE.name, avatar: PROFILE.avatar };
const SUMMARY: CareerSummary = { threeDartAvg: 60, wins: 2, gamesPlayed: 5 };

describe("RemoteMatch card exchange", () => {
  it("host sends its card on channel open when selfCard is set", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    new RemoteMatch({ role: "host", peer, bridge, applyState: () => {}, selfCard: { profile: PROFILE, summary: SUMMARY } }).start();
    peer.sent.length = 0;
    peer.fireOpen();
    expect(peer.sent).toContainEqual({ t: "card", profile: WIRE_PROFILE, summary: SUMMARY });
  });

  it("guest sends its card on channel open when selfCard is set", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    new RemoteMatch({ role: "guest", peer, bridge, applyState: () => {}, selfCard: { profile: PROFILE, summary: SUMMARY } }).start();
    peer.fireOpen();
    expect(peer.sent).toEqual([{ t: "card", profile: WIRE_PROFILE, summary: SUMMARY }]);
  });

  it("does not send a card when selfCard is absent", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    new RemoteMatch({ role: "guest", peer, bridge, applyState: () => {} }).start();
    peer.fireOpen();
    expect(peer.sent).toEqual([]);
  });

  it("calls onOpponentCard when a card message arrives (either role)", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const onOpponentCard = vi.fn();
    new RemoteMatch({ role: "host", peer, bridge, applyState: () => {}, onOpponentCard }).start();
    peer.fireData({ t: "card", profile: PROFILE, summary: SUMMARY });
    expect(onOpponentCard).toHaveBeenCalledWith(PROFILE, SUMMARY);
  });

  it("ignores a malformed card message", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const onOpponentCard = vi.fn();
    new RemoteMatch({ role: "guest", peer, bridge, applyState: () => {}, onOpponentCard }).start();
    peer.fireData({ t: "card", profile: "nope" });
    expect(onOpponentCard).not.toHaveBeenCalled();
  });

  it("ignores a card with empty profile/summary objects", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const onOpponentCard = vi.fn();
    new RemoteMatch({ role: "guest", peer, bridge, applyState: () => {}, onOpponentCard }).start();
    peer.fireData({ t: "card", profile: {}, summary: {} });
    expect(onOpponentCard).not.toHaveBeenCalled();
  });
});

describe("RemoteMatch guest requests (host side)", () => {
  const hostRM = () => { const peer = fakePeer(); const bridge = fakeBridge();
    const rm = new RemoteMatch({ role: "host", peer, bridge, applyState: () => {} }); rm.start(); return { peer, bridge, rm }; };

  it("miss on the guest's turn → record_miss", () => {
    const { peer, bridge } = hostRM();
    bridge.fireEvent({ type: "game_state", state: { ...STATE, active_index: 1 } });
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

describe("RemoteMatch chat", () => {
  it("sendChat trims, caps length, and puts the line on the wire", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const rm = new RemoteMatch({ role: "host", peer, bridge, applyState: () => {} });
    rm.start();
    rm.sendChat("  good darts!  ", "Ann");
    expect(peer.sent).toHaveLength(1);
    const msg = peer.sent[0] as { t: string; text: string; name: string; ts: number };
    expect(msg.t).toBe("chat");
    expect(msg.text).toBe("good darts!");
    expect(msg.name).toBe("Ann");
    expect(typeof msg.ts).toBe("number");
  });

  it("sendChat drops empty/whitespace lines", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const rm = new RemoteMatch({ role: "guest", peer, bridge, applyState: () => {} });
    rm.start();
    rm.sendChat("   ", "Ann");
    expect(peer.sent).toEqual([]);
  });

  it("delivers valid incoming chat to onChat for either role", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const got: Array<[string, string, number]> = [];
    const rm = new RemoteMatch({
      role: "guest", peer, bridge, applyState: () => {},
      onChat: (text, name, ts) => got.push([text, name, ts]),
    });
    rm.start();
    peer.fireData({ t: "chat", text: "hi", name: "Bo", ts: 123 });
    expect(got).toEqual([["hi", "Bo", 123]]);
  });

  it("rejects malformed chat (empty text, oversized text, missing ts)", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const got: string[] = [];
    const rm = new RemoteMatch({
      role: "host", peer, bridge, applyState: () => {},
      onChat: (text) => got.push(text),
    });
    rm.start();
    peer.fireData({ t: "chat", text: "", name: "Bo", ts: 1 });
    peer.fireData({ t: "chat", text: "x".repeat(501), name: "Bo", ts: 1 });
    peer.fireData({ t: "chat", text: "ok", name: "Bo" });
    expect(got).toEqual([]);
  });
});

describe("RemoteMatch turn clock", () => {
  it("host setTurnClock announces to the peer and re-announces on channel open", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const rm = new RemoteMatch({ role: "host", peer, bridge, applyState: () => {} });
    rm.start();
    rm.setTurnClock(45);
    expect(peer.sent).toContainEqual({ t: "clock", seconds: 45 });
    peer.sent.length = 0;
    peer.fireOpen(); // reconnect → guest needs the setting again
    expect(peer.sent).toContainEqual({ t: "clock", seconds: 45 });
  });

  it("guest applies an announced clock via onTurnClock", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const got: number[] = [];
    const rm = new RemoteMatch({
      role: "guest", peer, bridge, applyState: () => {},
      onTurnClock: (s) => got.push(s),
    });
    rm.start();
    peer.fireData({ t: "clock", seconds: 30 });
    expect(got).toEqual([30]);
  });

  it("guest setTurnClock is a no-op and a host ignores inbound clock msgs", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const got: number[] = [];
    const rm = new RemoteMatch({
      role: "host", peer, bridge, applyState: () => {},
      onTurnClock: (s) => got.push(s),
    });
    rm.start();
    peer.fireData({ t: "clock", seconds: 30 }); // host ignores
    expect(got).toEqual([]);

    const peer2 = fakePeer();
    const rm2 = new RemoteMatch({ role: "guest", peer: peer2, bridge: fakeBridge(), applyState: () => {} });
    rm2.start();
    rm2.setTurnClock(60); // guest can't set
    expect(peer2.sent).toEqual([]);
  });

  it("rejects out-of-range clock values", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const got: number[] = [];
    const rm = new RemoteMatch({
      role: "guest", peer, bridge, applyState: () => {},
      onTurnClock: (s) => got.push(s),
    });
    rm.start();
    peer.fireData({ t: "clock", seconds: -1 });
    peer.fireData({ t: "clock", seconds: 9999 });
    peer.fireData({ t: "clock", seconds: "30" });
    expect(got).toEqual([]);
  });
});
