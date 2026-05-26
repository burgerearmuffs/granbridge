import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock heavy deps so the session can be driven without WebRTC/media.
const joinFn = vi.fn();
const onJoinedCbs: Array<(self: any, peers: any[]) => void> = [];
const onPeersCbs: Array<(peers: any[]) => void> = [];
const emitPeers = (peers: any[]) => { for (const cb of onPeersCbs) cb(peers); };
vi.mock("./brokerClient", () => ({
  BrokerClient: class {
    constructor(public url: string) {}
    onJoined(cb: any) { onJoinedCbs.push(cb); return this; }
    onPeers(cb: any) { onPeersCbs.push(cb); return this; }
    onError() { return this; } onClose() { return this; }
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

// mpSession is a module-scoped singleton; leave() clears its rm/pm between tests.
beforeEach(() => { mpSession.leave(); useMpStore.getState().resetMp(); onJoinedCbs.length = 0; onPeersCbs.length = 0; joinFn.mockClear(); rmStart.mockClear(); rmStop.mockClear(); });

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
