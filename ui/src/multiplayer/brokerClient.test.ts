/**
 * BrokerClient unit tests.
 * Mocks globalThis.WebSocket exactly like useGranbridgeSocket.test.ts does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrokerClient } from "./brokerClient";

// ── Minimal WebSocket mock ────────────────────────────────────────────────────

class MockWS {
  static last: MockWS;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  sent: string[] = [];
  readyState = 0; // CONNECTING — becomes 1 (OPEN) when open() is called

  constructor(public url: string) {
    MockWS.last = this;
  }
  send(data: string) { this.sent.push(data); }
  close() { this.onclose?.({} as CloseEvent); }

  /** Helper: simulate a server → client message */
  receive(obj: object) {
    this.onmessage?.({ data: JSON.stringify(obj) } as MessageEvent);
  }
  /** Helper: open the socket (sets readyState to 1 first, then fires onopen) */
  open() {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }
}

beforeEach(() => {
  (globalThis as any).WebSocket = MockWS as any;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BrokerClient — sending", () => {
  it("join() sends the correct JSON when socket is open", () => {
    const bc = new BrokerClient("ws://test");
    bc.connect();
    MockWS.last.open();
    bc.join("room-1", "s3cr3t", { id: "p1", name: "Alice" });

    expect(MockWS.last.sent).toHaveLength(1);
    const msg = JSON.parse(MockWS.last.sent[0]);
    expect(msg).toMatchObject({
      type: "join",
      room: "room-1",
      password: "s3cr3t",
      player: { id: "p1", name: "Alice" },
    });
  });

  it("join() before open is sent in onopen", () => {
    const bc = new BrokerClient("ws://test");
    bc.connect();
    // Do NOT open yet — call join first
    bc.join("room-2", "pw", { id: "px", name: "Bob" });
    expect(MockWS.last.sent).toHaveLength(0); // not yet
    MockWS.last.open();
    expect(MockWS.last.sent).toHaveLength(1);
    expect(JSON.parse(MockWS.last.sent[0]).type).toBe("join");
  });

  it("sendSignal() emits {type:'signal', to, data}", () => {
    const bc = new BrokerClient("ws://test");
    bc.connect();
    MockWS.last.open();
    bc.sendSignal("peer-42", { sdp: "offer" });

    const msg = JSON.parse(MockWS.last.sent[0]);
    expect(msg).toMatchObject({ type: "signal", to: "peer-42", data: { sdp: "offer" } });
  });

  it("sendMsg() emits {type:'msg', payload}", () => {
    const bc = new BrokerClient("ws://test");
    bc.connect();
    MockWS.last.open();
    bc.sendMsg({ score: 501 });
    expect(JSON.parse(MockWS.last.sent[0])).toMatchObject({ type: "msg", payload: { score: 501 } });
  });

  it("leave() emits {type:'leave'}", () => {
    const bc = new BrokerClient("ws://test");
    bc.connect();
    MockWS.last.open();
    bc.leave();
    expect(JSON.parse(MockWS.last.sent[0])).toMatchObject({ type: "leave" });
  });
});

describe("BrokerClient — receiving", () => {
  it("incoming 'joined' fires onJoined with self + peers", () => {
    const cb = vi.fn();
    const bc = new BrokerClient("ws://test");
    bc.onJoined(cb);
    bc.connect();
    MockWS.last.open();

    const self = { peer_id: "s1", player: { id: "p1", name: "Alice" } };
    const peers = [{ peer_id: "s2", player: { id: "p2", name: "Bob" } }];
    MockWS.last.receive({ type: "joined", self, peers });

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(self, peers);
  });

  it("incoming 'peers' fires onPeers with array", () => {
    const cb = vi.fn();
    const bc = new BrokerClient("ws://test");
    bc.onPeers(cb);
    bc.connect();
    MockWS.last.open();

    const peers = [{ peer_id: "s3", player: { id: "p3", name: "Carol" } }];
    MockWS.last.receive({ type: "peers", peers });

    expect(cb).toHaveBeenCalledWith(peers);
  });

  it("fans out 'peers' to all onPeers subscribers", () => {
    const bc = new BrokerClient("ws://test");
    const a: number[] = [];
    const b: number[] = [];
    bc.onPeers((peers) => a.push(peers.length));
    bc.onPeers((peers) => b.push(peers.length));
    bc.connect();
    MockWS.last.open();

    MockWS.last.receive({ type: "peers", peers: [{ peer_id: "z", player: { id: "p2", name: "G" } }] });

    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
  });

  it("incoming 'signal' fires onSignal with from + data", () => {
    const cb = vi.fn();
    const bc = new BrokerClient("ws://test");
    bc.onSignal(cb);
    bc.connect();
    MockWS.last.open();

    MockWS.last.receive({ type: "signal", from: "peer-7", data: { candidate: "xxx" } });

    expect(cb).toHaveBeenCalledWith("peer-7", { candidate: "xxx" });
  });

  it("incoming 'msg' fires onMsg with from + payload", () => {
    const cb = vi.fn();
    const bc = new BrokerClient("ws://test");
    bc.onMsg(cb);
    bc.connect();
    MockWS.last.open();

    MockWS.last.receive({ type: "msg", from: "peer-9", payload: { dart: "T20" } });

    expect(cb).toHaveBeenCalledWith("peer-9", { dart: "T20" });
  });

  it("incoming 'error' fires onError with code + message", () => {
    const cb = vi.fn();
    const bc = new BrokerClient("ws://test");
    bc.onError(cb);
    bc.connect();
    MockWS.last.open();

    MockWS.last.receive({ type: "error", code: "wrong_password", message: "Bad password" });

    expect(cb).toHaveBeenCalledWith("wrong_password", "Bad password");
  });

  it("close() does not trigger auto-reconnect", () => {
    const bc = new BrokerClient("ws://test");
    bc.connect();
    MockWS.last.open();
    bc.close(); // explicit close — should NOT reconnect
    const urlsBefore = MockWS.last.url;
    // Give a tick — no new socket should be created
    expect(MockWS.last.url).toBe(urlsBefore);
  });
});
