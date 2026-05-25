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
import type { Profile } from "./player";
import type { CareerSummary } from "./careerSummary";

export type RemoteRole = "host" | "guest";

export type GuestAction = "miss" | "undo" | "correct" | "rematch";

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

export interface PeerCard {
  profile: Profile;
  summary: CareerSummary;
}

export type SyncMsg =
  | { t: "state"; state: GameState }
  | { t: "dart"; bed: string }
  | { t: "card"; profile: Profile; summary: CareerSummary }
  | { t: "matchid"; id: string }
  | { t: "req"; action: GuestAction; bed?: string };

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
  /** This client's advertised card; sent to the peer on channel open. */
  selfCard?: PeerCard | null;
  /** Called when the peer's card arrives. */
  onOpponentCard?: (profile: Profile, summary: CareerSummary) => void;
  /** Called with the shared remote match id (host on mint, guest on receive). */
  onMatchId?: (id: string) => void;
}

/**
 * Deterministic host election with NO extra signaling: the peer with the
 * lexicographically smaller id is the host. Both clients compute the same
 * answer from their own id + the peer list. Alone -> "host".
 *
 * NOTE: 2-player MVP — compares against peers[0]. For >2 players, compare
 * selfId against the minimum of all peer ids instead.
 */
export function hostRole(selfId: string, peers: PeerInfo[]): RemoteRole {
  if (peers.length === 0) return "host";
  return selfId < peers[0].peer_id ? "host" : "guest";
}

function isSyncMsg(o: unknown): o is SyncMsg {
  if (typeof o !== "object" || o === null) return false;
  const t = (o as { t?: unknown }).t;
  if (t === "state") return typeof (o as { state?: unknown }).state === "object";
  if (t === "dart") return typeof (o as { bed?: unknown }).bed === "string";
  if (t === "card") {
    const profile = (o as { profile?: { id?: unknown; name?: unknown; avatar?: { color?: unknown } } }).profile;
    const summary = (o as { summary?: { threeDartAvg?: unknown; wins?: unknown; gamesPlayed?: unknown } }).summary;
    return (
      !!profile && typeof profile.id === "string" && typeof profile.name === "string" &&
      !!profile.avatar && typeof profile.avatar.color === "string" &&
      !!summary && typeof summary.threeDartAvg === "number" &&
      typeof summary.wins === "number" && typeof summary.gamesPlayed === "number"
    );
  }
  if (t === "matchid") return typeof (o as { id?: unknown }).id === "string";
  if (t === "req") {
    const action = (o as { action?: unknown }).action;
    if (action !== "miss" && action !== "undo" && action !== "correct" && action !== "rematch") return false;
    if (action === "correct" && typeof (o as { bed?: unknown }).bed !== "string") return false;
    return true;
  }
  return false;
}

export class RemoteMatch {
  private _opts: Required<RemoteMatchOptions>;
  private _unsub: (() => void) | null = null;
  private _lastState: GameState | null = null;
  private _started = false;
  private _matchId: string | null = null;
  private _lastStart: { mode: string; players: string[]; options: Record<string, unknown> } | null = null;

  constructor(opts: RemoteMatchOptions) {
    this._opts = { hostSlot: "p1", guestSlot: "p2", selfCard: null, onOpponentCard: () => {}, onMatchId: () => {}, ...opts };
  }

  /** Wire peer + bridge callbacks. Idempotent. */
  start(): void {
    if (this._started) return;
    this._started = true;
    const { role, peer, bridge } = this._opts;

    peer.onDataMessage = (_peerId, obj) => this._onPeerMessage(obj);

    const sendCard = () => {
      const card = this._opts.selfCard;
      if (!card) return;
      const p = card.profile;
      // Never put the private writeToken on the wire — send only public fields.
      peer.sendData({ t: "card", profile: { id: p.id, name: p.name, avatar: p.avatar }, summary: card.summary });
    };

    if (role === "host") {
      peer.onChannelOpen = () => {
        if (this._matchId) peer.sendData({ t: "matchid", id: this._matchId });
        if (this._lastState) peer.sendData({ t: "state", state: this._lastState });
        sendCard();
      };
      this._unsub = bridge.onEvent((e) => {
        if (e.type === "game_state") {
          this._lastState = e.state;
          peer.sendData({ t: "state", state: e.state });
        }
      });
    } else {
      peer.onChannelOpen = () => { sendCard(); };
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
    this._matchId = crypto.randomUUID();
    this._opts.peer.sendData({ t: "matchid", id: this._matchId });
    this._opts.onMatchId(this._matchId);
    this._lastStart = { mode, players, options };
    this._opts.bridge.send({ command: "set_remote_role", player: this._opts.hostSlot });
    this._opts.bridge.send({ command: "start_game", mode, players, options });
  }

  /** Guest only: send a request to the host to perform an action on behalf of the guest. */
  requestAction(action: GuestAction, bed?: string): void {
    if (this._opts.role !== "guest") return;
    this._opts.peer.sendData(bed === undefined ? { t: "req", action } : { t: "req", action, bed });
  }

  /**
   * Tear down the orchestrator. `clearRole` (default true) also clears the host
   * engine's remote role so a later LOCAL game on that bridge isn't gate-filtered
   * — pass `false` on a transient unmount (e.g. tab switch) to KEEP the gate armed
   * for the still-running match while still unsubscribing (no leak).
   */
  stop(clearRole = true): void {
    this._unsub?.();
    this._unsub = null;
    this._started = false;
    // Detach peer handlers so a stopped orchestrator processes nothing.
    this._opts.peer.onDataMessage = () => {};
    this._opts.peer.onChannelOpen = () => {};
    if (clearRole && this._opts.role === "host") {
      this._opts.bridge.send({ command: "set_remote_role", player: null });
    }
  }

  private _handleGuestRequest(msg: { t: "req"; action: GuestAction; bed?: string }): void {
    const st = this._lastState;
    if (!st) return;
    const activeId = st.players[st.active_index]?.id;
    const guestTurn = activeId === this._opts.guestSlot;
    const { bridge } = this._opts;
    switch (msg.action) {
      case "miss": if (guestTurn) bridge.send({ command: "record_miss" }); break;
      case "undo": if (guestTurn && st.visit.length > 0) bridge.send({ command: "undo" }); break;
      case "correct": if (guestTurn && st.visit.length > 0 && typeof msg.bed === "string") bridge.send({ command: "correct_last", bed: msg.bed }); break;
      case "rematch": if (st.status === "finished" && this._lastStart) bridge.send({ command: "start_game", mode: this._lastStart.mode, players: this._lastStart.players, options: this._lastStart.options }); break;
    }
  }

  private _onPeerMessage(obj: unknown): void {
    if (!isSyncMsg(obj)) return;
    const msg = obj;
    const { role, bridge, guestSlot, applyState, onOpponentCard, onMatchId } = this._opts;
    if (msg.t === "card") {
      onOpponentCard(msg.profile, msg.summary);
      return;
    }
    if (msg.t === "matchid") {
      this._matchId = msg.id;
      onMatchId(msg.id);
      return;
    }
    if (role === "host") {
      if (msg.t === "dart") {
        bridge.send({ command: "remote_dart", bed: msg.bed, player: guestSlot });
      } else if (msg.t === "req") {
        this._handleGuestRequest(msg);
      }
    } else if (msg.t === "state") {
      applyState(msg.state);
    }
  }
}
