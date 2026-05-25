/**
 * BrokerClient — WebSocket wrapper for the Granbridge broker protocol.
 *
 * Broker protocol (MP-1, already built):
 *   client → { type:"join", room, password, player:{id,name,avatar?} }
 *   server → { type:"joined", self, peers:[{peer_id, player}] }
 *   server → { type:"peers",  peers:[{peer_id, player}] }
 *   server → { type:"signal", from, data }
 *   server → { type:"msg",    from, payload }
 *   server → { type:"error",  code, message }
 *   client → { type:"signal", to, data }
 *   client → { type:"msg",    payload }
 *   client → { type:"leave" }
 *
 * Uses the global `WebSocket` so tests can inject a mock (exactly like
 * useGranbridgeSocket.test.ts does).
 */

import type { AvatarSpec } from "./player";

export interface PeerInfo {
  peer_id: string;
  player: { id: string; name: string; avatar?: AvatarSpec };
}

export type BrokerCallbacks = {
  onJoined?: (self: PeerInfo, peers: PeerInfo[]) => void;
  onPeers?: (peers: PeerInfo[]) => void;
  onSignal?: (from: string, data: unknown) => void;
  onMsg?: (from: string, payload: unknown) => void;
  onError?: (code: string, message: string) => void;
  onClose?: () => void;
};

type BrokerMsg =
  | { type: "joined"; self: PeerInfo; peers: PeerInfo[] }
  | { type: "peers"; peers: PeerInfo[] }
  | { type: "signal"; from: string; data: unknown }
  | { type: "msg"; from: string; payload: unknown }
  | { type: "error"; code: string; message: string };

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

export class BrokerClient {
  private _url: string;
  private _ws: WebSocket | null = null;
  private _callbacks: BrokerCallbacks = {};
  /** `peers` is multi-subscriber: both mpSession and PeerManager register. */
  private _peersSubs: Array<(peers: PeerInfo[]) => void> = [];
  private _pendingJoin: { room: string; password: string; player: { id: string; name: string; avatar?: AvatarSpec } } | null = null;
  private _closed = false;
  private _retryCount = 0;
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Assign callbacks before calling connect(). */
  onJoined(cb: NonNullable<BrokerCallbacks["onJoined"]>) { this._callbacks.onJoined = cb; return this; }
  onPeers(cb: NonNullable<BrokerCallbacks["onPeers"]>) { this._peersSubs.push(cb); return this; }
  onSignal(cb: NonNullable<BrokerCallbacks["onSignal"]>) { this._callbacks.onSignal = cb; return this; }
  onMsg(cb: NonNullable<BrokerCallbacks["onMsg"]>) { this._callbacks.onMsg = cb; return this; }
  onError(cb: NonNullable<BrokerCallbacks["onError"]>) { this._callbacks.onError = cb; return this; }
  onClose(cb: NonNullable<BrokerCallbacks["onClose"]>) { this._callbacks.onClose = cb; return this; }

  constructor(url: string) {
    this._url = url;
  }

  connect(): void {
    if (this._closed) return;
    const ws = new WebSocket(this._url);
    this._ws = ws;

    ws.onopen = () => {
      this._retryCount = 0;
      if (this._pendingJoin) {
        this._send({ type: "join", ...this._pendingJoin });
      }
    };

    ws.onmessage = (ev: MessageEvent) => {
      let msg: BrokerMsg;
      try {
        msg = JSON.parse(ev.data as string) as BrokerMsg;
      } catch {
        return;
      }
      this._dispatch(msg);
    };

    ws.onclose = () => {
      if (!this._closed) {
        this._callbacks.onClose?.();
        this._scheduleRetry();
      }
    };
  }

  join(room: string, password: string, player: { id: string; name: string; avatar?: AvatarSpec }): void {
    this._pendingJoin = { room, password, player };
    if (this._ws && this._ws.readyState === 1 /* OPEN */) {
      this._send({ type: "join", room, password, player });
    }
    // If socket isn't open yet, will be sent in onopen.
  }

  sendSignal(to: string, data: unknown): void {
    this._send({ type: "signal", to, data });
  }

  sendMsg(payload: unknown): void {
    this._send({ type: "msg", payload });
  }

  leave(): void {
    this._pendingJoin = null;
    this._send({ type: "leave" });
  }

  close(): void {
    this._closed = true;
    if (this._retryTimer !== null) clearTimeout(this._retryTimer);
    this._ws?.close();
    this._ws = null;
  }

  // ── private ──────────────────────────────────────────────────────────────

  private _send(obj: object) {
    if (this._ws && this._ws.readyState === 1) {
      this._ws.send(JSON.stringify(obj));
    }
  }

  private _dispatch(msg: BrokerMsg) {
    switch (msg.type) {
      case "joined":
        this._callbacks.onJoined?.(msg.self, msg.peers);
        break;
      case "peers":
        for (const cb of this._peersSubs) cb(msg.peers);
        break;
      case "signal":
        this._callbacks.onSignal?.(msg.from, msg.data);
        break;
      case "msg":
        this._callbacks.onMsg?.(msg.from, msg.payload);
        break;
      case "error":
        this._callbacks.onError?.(msg.code, msg.message);
        break;
    }
  }

  private _scheduleRetry() {
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this._retryCount, BACKOFF_MAX_MS);
    this._retryCount++;
    this._retryTimer = setTimeout(() => {
      if (!this._closed) this.connect();
    }, delay);
  }
}
