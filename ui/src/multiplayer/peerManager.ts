/**
 * PeerManager — WebRTC perfect-negotiation over the broker signal relay.
 *
 * Guard: if `RTCPeerConnection` is undefined (jsdom / SSR) the constructor
 * no-ops and all methods are safe to call.
 *
 * Perfect-negotiation pattern:
 *   - "polite" peer: the one with the lexicographically smaller peer_id.
 *   - "impolite" peer: the one with the larger peer_id.
 * On offer collision the polite peer rolls back; the impolite peer ignores.
 *
 * Ice / TURN configuration:
 *   Relay-only: iceTransportPolicy "relay" forces every candidate through the
 *   broker-provided TURNS server (turns:DOMAIN:443?transport=tcp). Both peers
 *   relay, so coturn routes media between the two TLS/443 connections internally
 *   and no UDP relay range needs to be reachable. iceServers come from /turn.
 *
 * Data channel (label "granbridge"):
 *   Created by the impolite peer; negotiated automatically.
 *   sendData(obj) broadcasts to all open channels (for future game-sync in MP-3).
 */

import type { BrokerClient, PeerInfo } from "./brokerClient";

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [];

export type PeerState = "connecting" | "connected" | "disconnected" | "failed";

interface PeerEntry {
  peerId: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  makingOffer: boolean;
  ignoreOffer: boolean;
}

export class PeerManager {
  private _broker: BrokerClient;
  private _localStream: MediaStream | null;
  private _iceServers: RTCIceServer[];
  private _selfPeerId: string;
  private _peers = new Map<string, PeerEntry>();
  private _available: boolean;
  private _retries = new Map<string, number>();
  private static MAX_ICE_RESTARTS = 3;

  // Public callbacks
  onRemoteStream: (peerId: string, stream: MediaStream) => void = () => {};
  onDataMessage: (peerId: string, obj: unknown) => void = () => {};
  onPeerState: (peerId: string, state: PeerState) => void = () => {};
  onChannelOpen: (peerId: string) => void = () => {};
  onConnectionHealth: (peerId: string, health: "connected" | "reconnecting" | "lost") => void = () => {};

  constructor(
    broker: BrokerClient,
    selfPeerId: string,
    localStream: MediaStream | null,
    iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS,
  ) {
    this._broker = broker;
    this._selfPeerId = selfPeerId;
    this._localStream = localStream;
    this._iceServers = iceServers;

    // Guard: no-op if RTCPeerConnection is absent (jsdom / SSR)
    this._available = typeof RTCPeerConnection !== "undefined";
    if (!this._available) return;

    // Wire broker events
    broker.onPeers(this._handlePeers.bind(this));
    broker.onSignal(this._handleSignal.bind(this));
  }

  /** Handle a 'peers' event — connect to each new peer. */
  private _handlePeers(peers: PeerInfo[]) {
    for (const peer of peers) {
      if (!this._peers.has(peer.peer_id)) {
        this._createPeerConnection(peer.peer_id);
      }
    }
  }

  /** Disconnect and remove a peer. */
  removePeer(peerId: string) {
    const entry = this._peers.get(peerId);
    if (!entry) return;
    entry.pc.close();
    this._peers.delete(peerId);
  }

  /** Broadcast an object to all open data channels. */
  sendData(obj: unknown) {
    const payload = JSON.stringify(obj);
    for (const entry of this._peers.values()) {
      if (entry.dc && entry.dc.readyState === "open") {
        entry.dc.send(payload);
      }
    }
  }

  /** Close all connections. */
  closeAll() {
    for (const entry of this._peers.values()) entry.pc.close();
    this._peers.clear();
  }

  // ── internal ──────────────────────────────────────────────────────────────

  private _createPeerConnection(peerId: string) {
    const pc = new RTCPeerConnection({ iceServers: this._iceServers, iceTransportPolicy: "relay" });
    const isPolite = this._selfPeerId < peerId;

    const entry: PeerEntry = { peerId, pc, dc: null, makingOffer: false, ignoreOffer: false };
    this._peers.set(peerId, entry);

    // Add local tracks
    if (this._localStream) {
      for (const track of this._localStream.getTracks()) {
        pc.addTrack(track, this._localStream);
      }
    }

    // Data channel — created by the impolite peer (arbitrary; only one side creates it)
    if (!isPolite) {
      const dc = pc.createDataChannel("granbridge");
      entry.dc = dc;
      dc.onopen = () => this.onChannelOpen(peerId);
      dc.onmessage = (ev) => {
        try { this.onDataMessage(peerId, JSON.parse(ev.data as string)); } catch { /* ignore */ }
      };
    }

    // Incoming tracks → remote stream
    const remoteStream = new MediaStream();
    pc.ontrack = (ev) => {
      for (const track of ev.streams?.[0]?.getTracks() ?? [ev.track]) {
        remoteStream.addTrack(track);
      }
      this.onRemoteStream(peerId, remoteStream);
    };

    // Receive data channel from polite peer
    pc.ondatachannel = (ev) => {
      entry.dc = ev.channel;
      ev.channel.onopen = () => this.onChannelOpen(peerId);
      ev.channel.onmessage = (me) => {
        try { this.onDataMessage(peerId, JSON.parse(me.data as string)); } catch { /* ignore */ }
      };
    };

    // ICE candidates → broker
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this._broker.sendSignal(peerId, { candidate: ev.candidate });
      }
    };

    // Connection state
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState as PeerState;
      this.onPeerState(peerId, state);
      if (state === "connected") { this._retries.set(peerId, 0); this.onConnectionHealth(peerId, "connected"); }
      else if (state === "disconnected" || state === "failed") { this._attemptRestart(peerId); }
    };

    // Negotiation-needed (perfect-negotiation)
    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        this._broker.sendSignal(peerId, { description: pc.localDescription });
      } catch (err) {
        console.error("[peerManager] negotiationneeded error:", err);
      } finally {
        entry.makingOffer = false;
      }
    };

    return entry;
  }

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
      if (typeof (e.pc as RTCPeerConnection & { restartIce?: () => void }).restartIce === "function") {
        (e.pc as RTCPeerConnection & { restartIce?: () => void }).restartIce!();
      }
    }, delay);
  }

  private async _handleSignal(from: string, data: unknown) {
    if (!this._available) return;
    const sig = data as { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

    let entry = this._peers.get(from);
    if (!entry) {
      // Polite peer creates a connection in response to an incoming offer
      entry = this._createPeerConnection(from);
    }
    const { pc } = entry;
    const isPolite = this._selfPeerId < from;

    try {
      if (sig.description) {
        const offerCollision =
          sig.description.type === "offer" && (entry.makingOffer || pc.signalingState !== "stable");
        entry.ignoreOffer = !isPolite && offerCollision;
        if (entry.ignoreOffer) return;

        await pc.setRemoteDescription(sig.description);
        if (sig.description.type === "offer") {
          await pc.setLocalDescription();
          this._broker.sendSignal(from, { description: pc.localDescription });
        }
      } else if (sig.candidate) {
        try {
          await pc.addIceCandidate(sig.candidate);
        } catch (err) {
          if (!entry.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error("[peerManager] signal error:", err);
    }
  }
}
