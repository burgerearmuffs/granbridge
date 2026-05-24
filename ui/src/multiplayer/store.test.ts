import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useMpStore, readBrokerUrl } from "./store";

beforeEach(() => {
  localStorage.clear();
  useMpStore.getState().resetMp();
  // Also reset derived persisted fields to defaults
  useMpStore.setState({ brokerUrl: "ws://127.0.0.1:8788", mic: true, cam: true });
});

describe("multiplayer store — actions", () => {
  it("starts idle", () => {
    expect(useMpStore.getState().mpStatus).toBe("idle");
  });

  it("setMpStatus transitions state", () => {
    useMpStore.getState().setMpStatus("connecting");
    expect(useMpStore.getState().mpStatus).toBe("connecting");
    useMpStore.getState().setMpStatus("in_room");
    expect(useMpStore.getState().mpStatus).toBe("in_room");
    useMpStore.getState().setMpStatus("error");
    expect(useMpStore.getState().mpStatus).toBe("error");
  });

  it("setRoom stores room id", () => {
    useMpStore.getState().setRoom("my-room");
    expect(useMpStore.getState().room).toBe("my-room");
  });

  it("setSelfId stores self id", () => {
    useMpStore.getState().setSelfId("peer-abc");
    expect(useMpStore.getState().selfId).toBe("peer-abc");
  });

  it("setPeers stores peer array", () => {
    const peers = [{ peer_id: "p1", player: { id: "x", name: "X" } }];
    useMpStore.getState().setPeers(peers);
    expect(useMpStore.getState().peers).toHaveLength(1);
    expect(useMpStore.getState().peers[0].peer_id).toBe("p1");
  });

  it("setMic persists to localStorage", () => {
    useMpStore.getState().setMic(false);
    expect(useMpStore.getState().mic).toBe(false);
    expect(localStorage.getItem("granbridge.mp.mic")).toBe("false");
  });

  it("setCam persists to localStorage", () => {
    useMpStore.getState().setCam(false);
    expect(useMpStore.getState().cam).toBe(false);
    expect(localStorage.getItem("granbridge.mp.cam")).toBe("false");
  });

  it("setError stores error string", () => {
    useMpStore.getState().setError("connection refused");
    expect(useMpStore.getState().error).toBe("connection refused");
  });

  it("setBrokerUrl persists to localStorage", () => {
    useMpStore.getState().setBrokerUrl("wss://tower.local:8788");
    expect(useMpStore.getState().brokerUrl).toBe("wss://tower.local:8788");
    expect(localStorage.getItem("granbridge.mp.brokerUrl")).toBe("wss://tower.local:8788");
  });

  it("resetMp clears room/selfId/peers/error but keeps brokerUrl", () => {
    useMpStore.getState().setRoom("x");
    useMpStore.getState().setSelfId("y");
    useMpStore.getState().setError("oops");
    useMpStore.getState().setBrokerUrl("wss://example.com");
    useMpStore.getState().resetMp();

    const s = useMpStore.getState();
    expect(s.mpStatus).toBe("idle");
    expect(s.room).toBe("");
    expect(s.selfId).toBe("");
    expect(s.peers).toHaveLength(0);
    expect(s.error).toBeUndefined();
    // brokerUrl survives reset
    expect(s.brokerUrl).toBe("wss://example.com");
  });
});

describe("readBrokerUrl default", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("uses VITE_BROKER_URL when set and no localStorage override", () => {
    localStorage.removeItem("granbridge.mp.brokerUrl");
    vi.stubEnv("VITE_BROKER_URL", "wss://play.example.com");
    expect(readBrokerUrl()).toBe("wss://play.example.com");
  });

  it("falls back to localhost when neither is set", () => {
    localStorage.removeItem("granbridge.mp.brokerUrl");
    expect(readBrokerUrl()).toBe("ws://127.0.0.1:8788");
  });
});

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
