/**
 * RemoteMatch — host-authoritative remote game sync (MP-3).
 *
 * Pure orchestrator on top of MP-2's data channel (PeerLike) and the bridge
 * WebSocket (BridgeLike). No React, no WebRTC, no DOM — fully unit-testable.
 *
 * Data-channel protocol (host <-> guest):
 *   guest -> host : { t: "dart", bed }     (a board hit to score)
 *   host  -> guest: { t: "state", state }  (authoritative game_state to render)
 *
 * Host: only its bridge engine scores. On bridge `game_state` it pushes the
 * state to the guest; on a peer `dart` it sends a `remote_dart` command to its
 * bridge tagged with the guest's slot (the engine gates by active player).
 * Guest: never starts a local game; forwards its `dart_hit`s and renders the
 * state the host pushes.
 */

import type { Command, Event, GameState } from "../types";
import type { PeerInfo } from "./brokerClient";

export type RemoteRole = "host" | "guest";

/** The slice of PeerManager that RemoteMatch needs (real PeerManager satisfies it). */
export interface PeerLike {
  sendData(obj: unknown): void;
  onDataMessage: (peerId: string, obj: unknown) => void;
  onChannelOpen: (peerId: string) => void;
}

/** Send a bridge command + subscribe to inbound bridge events (bridgeLink satisfies it). */
export interface BridgeLike {
  send(cmd: Command): void;
  onEvent(cb: (e: Event) => void): () => void;
}

export type SyncMsg =
  | { t: "state"; state: GameState }
  | { t: "dart"; bed: string };

export interface RemoteMatchOptions {
  role: RemoteRole;
  peer: PeerLike;
  bridge: BridgeLike;
  /** Guest-side: apply the host's pushed state (e.g. into the game store). */
  applyState: (state: GameState) => void;
  /** Engine slot the host's local board feeds. Default "p1". */
  hostSlot?: string;
  /** Engine slot the guest's darts are scored as. Default "p2". */
  guestSlot?: string;
}

/**
 * Deterministic host election with NO extra signaling: the peer with the
 * lexicographically smaller id is the host. Both clients compute the same
 * answer from their own id + the peer list. Alone -> "host".
 */
export function hostRole(selfId: string, peers: PeerInfo[]): RemoteRole {
  if (peers.length === 0) return "host";
  return selfId < peers[0].peer_id ? "host" : "guest";
}

export class RemoteMatch {
  private _opts: Required<RemoteMatchOptions>;
  private _unsub: (() => void) | null = null;
  private _lastState: GameState | null = null;
  private _started = false;

  constructor(opts: RemoteMatchOptions) {
    this._opts = { hostSlot: "p1", guestSlot: "p2", ...opts };
  }

  /** Wire peer + bridge callbacks. Idempotent. */
  start(): void {
    if (this._started) return;
    this._started = true;
    const { role, peer, bridge } = this._opts;

    peer.onDataMessage = (_peerId, obj) => this._onPeerMessage(obj as SyncMsg);

    if (role === "host") {
      // Re-send the latest snapshot whenever a (re)connecting guest channel opens.
      peer.onChannelOpen = () => {
        if (this._lastState) peer.sendData({ t: "state", state: this._lastState });
      };
      this._unsub = bridge.onEvent((e) => {
        if (e.type === "game_state") {
          this._lastState = e.state;
          peer.sendData({ t: "state", state: e.state });
        }
      });
    } else {
      peer.onChannelOpen = () => {};
      this._unsub = bridge.onEvent((e) => {
        if (e.type === "dart_hit") {
          peer.sendData({ t: "dart", bed: e.bed });
        }
      });
    }
  }

  /** Host only: begin a remote match — set the engine role, then start the game. */
  startGame(mode: string, players: string[], options: Record<string, unknown>): void {
    if (this._opts.role !== "host") return;
    this._opts.bridge.send({ command: "set_remote_role", player: this._opts.hostSlot });
    this._opts.bridge.send({ command: "start_game", mode, players, options });
  }

  stop(): void {
    this._unsub?.();
    this._unsub = null;
    this._started = false;
    // Clear the gate so a later local game on the host bridge isn't filtered.
    if (this._opts.role === "host") {
      this._opts.bridge.send({ command: "set_remote_role", player: null });
    }
  }

  private _onPeerMessage(msg: SyncMsg): void {
    const { role, bridge, guestSlot, applyState } = this._opts;
    if (role === "host") {
      if (msg && msg.t === "dart") {
        bridge.send({ command: "remote_dart", bed: msg.bed, player: guestSlot });
      }
    } else if (msg && msg.t === "state") {
      applyState(msg.state);
    }
  }
}
