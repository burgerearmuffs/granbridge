/**
 * Light PeerManager tests — uses a minimal fake RTCPeerConnection assigned to
 * globalThis so the guard passes; real negotiation is verified manually.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PeerManager } from "./peerManager";
import { BrokerClient } from "./brokerClient";

// ── Minimal RTCPeerConnection fake ────────────────────────────────────────────

class FakeDataChannel {
  readyState: "open" | "closed" = "open";
  sent: string[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  send(data: string) { this.sent.push(data); }
}

class FakePC {
  static instances: FakePC[] = [];
  iceServers: RTCIceServer[];
  iceTransportPolicy: string | undefined;
  ontrack: ((ev: any) => void) | null = null;
  ondatachannel: ((ev: any) => void) | null = null;
  onicecandidate: ((ev: any) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState = "connecting";
  signalingState = "stable";
  _channels: FakeDataChannel[] = [];
  restartIceCalls = 0;
  restartIce() { this.restartIceCalls++; }

  constructor(config: { iceServers: RTCIceServer[]; iceTransportPolicy?: string }) {
    this.iceServers = config.iceServers;
    this.iceTransportPolicy = (config as { iceTransportPolicy?: string }).iceTransportPolicy;
    FakePC.instances.push(this);
  }
  addTrack() {}
  createDataChannel(_label: string) {
    const dc = new FakeDataChannel();
    this._channels.push(dc);
    return dc;
  }
  close() {}
}

// ── Minimal BrokerClient mock ─────────────────────────────────────────────────

function makeMockBroker() {
  const bc = {
    _peersHandler: null as ((peers: any[]) => void) | null,
    _signalHandler: null as ((from: string, data: unknown) => void) | null,
    onPeers(cb: (peers: any[]) => void) { bc._peersHandler = cb; return bc; },
    onSignal(cb: (from: string, data: unknown) => void) { bc._signalHandler = cb; return bc; },
    onJoined() { return bc; },
    onMsg() { return bc; },
    onError() { return bc; },
    onClose() { return bc; },
    sendSignal: vi.fn(),
    sendMsg: vi.fn(),
    // simulate incoming peers event
    _emitPeers(peers: any[]) { bc._peersHandler?.(peers); },
    // simulate incoming signal
    _emitSignal(from: string, data: unknown) { bc._signalHandler?.(from, data); },
  };
  return bc;
}

beforeEach(() => {
  (globalThis as any).RTCPeerConnection = FakePC as any;
  (globalThis as any).MediaStream = class { addTrack() {} getTracks() { return []; } };
  FakePC.instances = [];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PeerManager (light, fake RTCPeerConnection)", () => {
  it("creates a peer connection when peers event fires", () => {
    const broker = makeMockBroker() as unknown as BrokerClient;
    new PeerManager(broker, "aaa", null);

    (broker as any)._emitPeers([{ peer_id: "bbb", player: { id: "p2", name: "Bob" } }]);

    expect(FakePC.instances).toHaveLength(1);
  });

  it("impolite peer (higher id) creates the data channel", () => {
    const broker = makeMockBroker() as unknown as BrokerClient;
    // "zzz" > "aaa" so this peer is impolite → creates data channel
    new PeerManager(broker, "zzz", null);

    (broker as any)._emitPeers([{ peer_id: "aaa", player: { id: "p1", name: "Alice" } }]);

    const pc = FakePC.instances[0];
    expect(pc._channels).toHaveLength(1); // data channel created
  });

  it("polite peer (lower id) does NOT create the data channel", () => {
    const broker = makeMockBroker() as unknown as BrokerClient;
    // "aaa" < "zzz" so this peer is polite → does NOT create data channel
    new PeerManager(broker, "aaa", null);

    (broker as any)._emitPeers([{ peer_id: "zzz", player: { id: "p2", name: "Zoe" } }]);

    const pc = FakePC.instances[0];
    expect(pc._channels).toHaveLength(0);
  });

  it("sendData calls send on an open fake channel", () => {
    const broker = makeMockBroker() as unknown as BrokerClient;
    const pm = new PeerManager(broker, "zzz", null);

    (broker as any)._emitPeers([{ peer_id: "aaa", player: { id: "p1", name: "Alice" } }]);

    const dc = FakePC.instances[0]._channels[0];
    expect(dc).toBeDefined();

    pm.sendData({ score: 501 });
    expect(dc.sent).toHaveLength(1);
    expect(JSON.parse(dc.sent[0])).toMatchObject({ score: 501 });
  });

  it("no-ops when RTCPeerConnection is undefined", () => {
    (globalThis as any).RTCPeerConnection = undefined;
    const broker = makeMockBroker() as unknown as BrokerClient;
    // Should not throw
    const pm = new PeerManager(broker, "aaa", null);
    expect(() => pm.sendData({ x: 1 })).not.toThrow();
    expect(() => pm.closeAll()).not.toThrow();
  });

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

  it("constructs peer connections with relay-only ICE policy", () => {
    FakePC.instances.length = 0;
    const broker = makeMockBroker();
    const pm = new PeerManager(broker as unknown as BrokerClient, "self", null, [
      { urls: ["turns:d:443?transport=tcp"], username: "u", credential: "c" },
    ]);
    (broker as any)._emitPeers([{ peer_id: "zzz" }]);
    expect(FakePC.instances).toHaveLength(1);
    expect(FakePC.instances[0].iceTransportPolicy).toBe("relay");
    pm.closeAll();
  });
});

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
