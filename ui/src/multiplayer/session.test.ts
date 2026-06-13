import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock heavy deps so the session can be driven without WebRTC/media.
const joinFn = vi.fn();
const sendMsgFn = vi.fn();
const onJoinedCbs: Array<(self: any, peers: any[], spectators?: number) => void> = [];
const onPeersCbs: Array<(peers: any[], spectators?: number) => void> = [];
const onMsgCbs: Array<(from: string, payload: unknown) => void> = [];
const emitPeers = (peers: any[], spectators?: number) => { for (const cb of onPeersCbs) cb(peers, spectators); };
const emitMsg = (from: string, payload: unknown) => { for (const cb of onMsgCbs) cb(from, payload); };
vi.mock("./brokerClient", () => ({
  BrokerClient: class {
    constructor(public url: string) {}
    onJoined(cb: any) { onJoinedCbs.push(cb); return this; }
    onPeers(cb: any) { onPeersCbs.push(cb); return this; }
    onMsg(cb: any) { onMsgCbs.push(cb); return this; }
    onError() { return this; } onClose() { return this; }
    connect() {} join(...a: any[]) { joinFn(...a); } leave() {} close() {}
    sendMsg(payload: unknown) { sendMsgFn(payload); }
  },
}));
const rmStart = vi.fn(); const rmStop = vi.fn(); const rmStartGame = vi.fn();
vi.mock("./peerManager", () => ({ PeerManager: class { onRemoteStream:any=()=>{}; onConnectionHealth:any=()=>{}; closeAll(){} } }));
vi.mock("./remoteMatch", async (orig) => {
  const actual = await orig<any>();
  return { ...actual, RemoteMatch: class { start = rmStart; stop = rmStop; startGame = rmStartGame; } };
});
vi.mock("./media", () => ({
  getLocalStream: vi.fn(async () => null),
  acquireLocalMedia: vi.fn(async () => ({ stream: null, failure: null })),
  buildConstraints: vi.fn(() => ({ video: true, audio: true })),
}));
vi.mock("./turn", () => ({
  fetchIceServers: vi.fn(async () => [
    { urls: ["turns:test:443?transport=tcp"], username: "u", credential: "c" },
  ]),
}));
vi.mock("./careerSummary", () => ({ fetchMyCareerSummary: vi.fn(async () => ({ threeDartAvg: 0, wins: 0, gamesPlayed: 0 })) }));

import { mpSession } from "./session";
import { useMpStore } from "./store";
import { useStore } from "../store";

// mpSession is a module-scoped singleton; leave() clears its rm/pm between tests.
beforeEach(() => {
  mpSession.leave();
  useMpStore.getState().resetMp();
  useStore.setState({ gameState: null });
  onJoinedCbs.length = 0; onPeersCbs.length = 0; onMsgCbs.length = 0;
  joinFn.mockClear(); sendMsgFn.mockClear(); rmStart.mockClear(); rmStop.mockClear();
});

const JOIN = { room: "r", password: "p", displayName: "Me", brokerUrl: "ws://x" };

describe("mpSession", () => {
  it("join → broker.join called and status connecting", async () => {
    await mpSession.join(JOIN);
    expect(joinFn).toHaveBeenCalledTimes(1);
    expect(["connecting", "in_room"]).toContain(useMpStore.getState().mpStatus);
  });

  it("onJoined with a peer sets in_room and starts a RemoteMatch", async () => {
    await mpSession.join(JOIN);
    onJoinedCbs[0]("aaa", [{ peer_id: "zzz", player: { id: "p2", name: "G" } }]);
    expect(useMpStore.getState().mpStatus).toBe("in_room");
    expect(useMpStore.getState().selfId).toBe("aaa");
    expect(rmStart).toHaveBeenCalled();
  });

  it("host-first: onJoined with empty peers, then a 'peers' event starts the match", async () => {
    await mpSession.join(JOIN);
    // Host opens the room first → joined arrives with NO peers yet.
    onJoinedCbs[0]("host", []);
    expect(useMpStore.getState().mpStatus).toBe("in_room");
    expect(useMpStore.getState().selfId).toBe("host");
    expect(useMpStore.getState().peers.length).toBe(0);
    expect(rmStart).not.toHaveBeenCalled();

    // Opponent joins later → broker broadcasts a 'peers' event.
    emitPeers([{ peer_id: "guest", player: { id: "p2", name: "G" } }]);

    expect(useMpStore.getState().peers.length).toBe(1);
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
    onJoinedCbs[0]("aaa", [{ peer_id: "zzz", player: { id: "p2", name: "G" } }]);
    mpSession.leave();
    expect(rmStop).toHaveBeenCalled();
    expect(useMpStore.getState().mpStatus).toBe("idle");
  });
});

describe("mpSession TURN unavailable", () => {
  it("aborts the join with a clear error when /turn yields no ICE servers", async () => {
    const { fetchIceServers } = await import("./turn");
    vi.mocked(fetchIceServers).mockResolvedValueOnce([]);
    await mpSession.join(JOIN);
    const s = useMpStore.getState();
    expect(s.mpStatus).toBe("error");
    expect(s.error).toMatch(/call-relay credentials/i);
    expect(joinFn).not.toHaveBeenCalled(); // never reached the broker join
    expect(s.localStream).toBeNull();
  });

  it("spectator join does not consult /turn at all", async () => {
    const { fetchIceServers } = await import("./turn");
    vi.mocked(fetchIceServers).mockClear();
    await mpSession.join({ ...JOIN, spectate: true });
    expect(fetchIceServers).not.toHaveBeenCalled();
    expect(useMpStore.getState().mpStatus).not.toBe("error");
    expect(joinFn).toHaveBeenCalledTimes(1);
  });
});

const STATE = {
  mode: "x01", status: "in_progress",
  players: [{ id: "p1", name: "H" }, { id: "p2", name: "G" }],
  active_index: 0, visit: [], legs: {}, sets: {}, winner: null,
  options: {}, mode_view: {}, stats: {},
};

describe("mpSession spectator", () => {
  it("spectator join passes the flag, never builds a RemoteMatch, applies relayed state", async () => {
    await mpSession.join({ ...JOIN, spectate: true });
    expect(joinFn).toHaveBeenCalledTimes(1);
    expect(joinFn.mock.calls[0][3]).toEqual({ spectator: true });

    onJoinedCbs[0]("spec1", [{ peer_id: "h1", player: { id: "p1", name: "H" } }], 1);
    expect(useMpStore.getState().mpStatus).toBe("in_room");
    expect(useMpStore.getState().spectate).toBe(true);
    expect(useMpStore.getState().spectatorCount).toBe(1);
    expect(rmStart).not.toHaveBeenCalled();

    emitMsg("h1", { t: "spectate_state", state: STATE });
    expect(useStore.getState().gameState?.mode).toBe("x01");
  });

  it("spectator ignores malformed relayed payloads", async () => {
    await mpSession.join({ ...JOIN, spectate: true });
    onJoinedCbs[0]("spec1", [], 1);
    emitMsg("h1", { t: "spectate_state" });          // no state
    emitMsg("h1", { t: "other", state: STATE });     // wrong tag
    expect(useStore.getState().gameState).toBeNull();
  });

  it("host mirrors game_state to the room while spectators are present", async () => {
    const { bridgeLink } = await import("../bridgeLink");
    await mpSession.join(JOIN);
    // Host (self < peer) with one spectator watching.
    onJoinedCbs[0]("aaa", [{ peer_id: "zzz", player: { id: "p2", name: "G" } }], 1);
    bridgeLink.emit({ type: "game_state", state: STATE } as never);
    expect(sendMsgFn).toHaveBeenCalledWith({ t: "spectate_state", state: STATE });

    // No spectators → no mirroring.
    sendMsgFn.mockClear();
    emitPeers([{ peer_id: "zzz", player: { id: "p2", name: "G" } }], 0);
    bridgeLink.emit({ type: "game_state", state: STATE } as never);
    expect(sendMsgFn).not.toHaveBeenCalled();
  });

  it("host pushes the current state when a new spectator joins", async () => {
    await mpSession.join(JOIN);
    onJoinedCbs[0]("aaa", [{ peer_id: "zzz", player: { id: "p2", name: "G" } }], 0);
    useStore.setState({ gameState: STATE as never });
    emitPeers([{ peer_id: "zzz", player: { id: "p2", name: "G" } }], 1);
    expect(sendMsgFn).toHaveBeenCalledWith({ t: "spectate_state", state: STATE });
  });

  it("guest does not mirror even with spectators present", async () => {
    const { bridgeLink } = await import("../bridgeLink");
    await mpSession.join(JOIN);
    // Guest (self > peer).
    onJoinedCbs[0]("zzz", [{ peer_id: "aaa", player: { id: "p1", name: "H" } }], 1);
    sendMsgFn.mockClear();
    bridgeLink.emit({ type: "game_state", state: STATE } as never);
    expect(sendMsgFn).not.toHaveBeenCalled();
  });
});
