/**
 * mpSession — the live multiplayer session, owned at module scope (like bridgeLink)
 * so it survives React view unmounts (tab switches). Holds the BrokerClient,
 * PeerManager and RemoteMatch; pushes reactive state into useMpStore.
 */
import { useMpStore } from "./store";
import { getOrCreatePlayer, setPlayerName } from "./player";
import { BrokerClient, type PeerInfo } from "./brokerClient";
import { PeerManager } from "./peerManager";
import { acquireLocalMedia, buildConstraints, type MediaFailure } from "./media";
import { fetchIceServers } from "./turn";
import { fetchMyCareerSummary } from "./careerSummary";
import { RemoteMatch, hostRole, CHAT_MAX_LEN, type GuestAction } from "./remoteMatch";
import { resolveOpponentSummary } from "../stats/statsClient";
import { bridgeLink } from "../bridgeLink";
import { useStore } from "../store";
import type { Profile } from "./player";
import type { CareerSummary } from "./careerSummary";

export interface JoinOpts {
  room: string;
  password: string;
  displayName: string;
  brokerUrl: string;
  /** Watch-only: no media, no WebRTC — render the state the host relays via the broker. */
  spectate?: boolean;
}

/** Broker-relayed state for spectators (host → room when spectators are present). */
export interface SpectateStateMsg { t: "spectate_state"; state: import("../types").GameState }

function isSpectateState(o: unknown): o is SpectateStateMsg {
  return (
    typeof o === "object" && o !== null &&
    (o as { t?: unknown }).t === "spectate_state" &&
    typeof (o as { state?: unknown }).state === "object" && (o as { state?: unknown }).state !== null
  );
}

/** Human message for a media acquisition failure (null = no notice). */
export function mediaNoticeFor(failure: MediaFailure): string | undefined {
  switch (failure) {
    case "denied":
      return "Camera/mic permission denied — you're in the room without audio or video. " +
        "Allow camera & microphone access in Windows privacy settings, then rejoin.";
    case "unsupported":
      return "Camera/mic isn't available in this environment — joined without audio or video.";
    case "failed":
      return "Couldn't start the camera/mic — joined without audio or video. " +
        "Another app may be using the device.";
    default:
      return undefined;
  }
}

class MpSession {
  private broker: BrokerClient | null = null;
  private pm: PeerManager | null = null;
  private rm: RemoteMatch | null = null;
  private selfCard: { profile: Profile; summary: CareerSummary } | null = null;
  private unsubMirror: (() => void) | null = null;

  async join(opts: JoinOpts): Promise<void> {
    const store = useMpStore.getState();
    if (store.mpStatus === "connecting" || store.mpStatus === "in_room") return; // idempotent
    store.setError(undefined);
    store.setMpStatus("connecting");
    store.setRoom(opts.room);
    store.setSpectate(!!opts.spectate);

    const player = setPlayerName(opts.displayName.trim() || getOrCreatePlayer().name);
    if (opts.brokerUrl.trim()) store.setBrokerUrl(opts.brokerUrl.trim());
    const url = opts.brokerUrl.trim() || useMpStore.getState().brokerUrl;

    if (opts.spectate) {
      this._joinAsSpectator(url, opts, player);
      return;
    }

    const { mic, cam, camDeviceId, micDeviceId } = useMpStore.getState();
    const { stream, failure } = await acquireLocalMedia(
      buildConstraints(cam, mic, camDeviceId, micDeviceId),
    );
    useMpStore.getState().setLocalStream(stream);
    useMpStore.getState().setMediaNotice(mediaNoticeFor(failure));

    this.selfCard = { profile: player, summary: await fetchMyCareerSummary(player.name) };

    const iceServers = await fetchIceServers(url);
    // Relay-only WebRTC cannot produce a single candidate without the broker's
    // TURNS credentials — joining would just hang. Fail loudly instead.
    if (iceServers.length === 0) {
      useMpStore.getState().localStream?.getTracks().forEach((t) => t.stop());
      useMpStore.getState().setLocalStream(null);
      const s = useMpStore.getState();
      s.setError(
        `Couldn't get call-relay credentials from the broker (${url} /turn). ` +
        "The match connection can't be made without them — check the broker URL " +
        "in Settings and that the server is up, then try again.",
      );
      s.setMpStatus("error");
      return;
    }

    const bc = new BrokerClient(url);
    this.broker = bc;

    bc.onJoined((self: string, initialPeers: PeerInfo[], spectators?: number) => {
      const s = useMpStore.getState();
      s.setSelfId(self);
      s.setPeers(initialPeers);
      s.setSpectatorCount(spectators ?? 0);
      s.setMpStatus("in_room");

      const pm = new PeerManager(bc, self, stream, iceServers);
      this.pm = pm;
      pm.onRemoteStream = (peerId, rs) => useMpStore.getState().setRemoteStream(peerId, rs);
      pm.onConnectionHealth = (_peerId, health) => useMpStore.getState().setConnectionHealth(health);
      this.ensureRemoteMatch();
      this._ensureSpectatorMirror(bc);
    });

    bc.onPeers((latest: PeerInfo[], spectators?: number) => {
      const s = useMpStore.getState();
      const prevSpectators = s.spectatorCount;
      s.setPeers(latest);
      s.setSpectatorCount(spectators ?? 0);
      this.ensureRemoteMatch();
      // A new spectator needs the current state immediately, not on the next dart.
      if ((spectators ?? 0) > prevSpectators) this._pushStateToSpectators(bc);
    });
    bc.onError((code, message) => { const s = useMpStore.getState(); s.setError(`${code}: ${message}`); s.setMpStatus("error"); });
    bc.onClose(() => { const s = useMpStore.getState(); if (s.mpStatus === "in_room") { s.setMpStatus("error"); s.setError("Disconnected from broker"); } });

    bc.connect();
    bc.join(opts.room, opts.password, { id: player.id, name: player.name, avatar: player.avatar });
  }

  /** Watch-only path: broker presence + relayed game state; no media, no PeerManager. */
  private _joinAsSpectator(url: string, opts: JoinOpts, player: Profile): void {
    const bc = new BrokerClient(url);
    this.broker = bc;

    bc.onJoined((self: string, initialPeers: PeerInfo[], spectators?: number) => {
      const s = useMpStore.getState();
      s.setSelfId(self);
      s.setPeers(initialPeers);
      s.setSpectatorCount(spectators ?? 0);
      s.setMpStatus("in_room");
    });
    bc.onPeers((latest: PeerInfo[], spectators?: number) => {
      const s = useMpStore.getState();
      s.setPeers(latest);
      s.setSpectatorCount(spectators ?? 0);
    });
    bc.onMsg((_from, payload) => {
      if (isSpectateState(payload)) {
        useStore.getState().applyEvent({ type: "game_state", state: payload.state });
      }
    });
    bc.onError((code, message) => { const s = useMpStore.getState(); s.setError(`${code}: ${message}`); s.setMpStatus("error"); });
    bc.onClose(() => { const s = useMpStore.getState(); if (s.mpStatus === "in_room") { s.setMpStatus("error"); s.setError("Disconnected from broker"); } });

    bc.connect();
    bc.join(opts.room, opts.password, { id: player.id, name: player.name, avatar: player.avatar }, { spectator: true });
  }

  /** Host-side: mirror authoritative game_state to the room while spectators are watching. */
  private _ensureSpectatorMirror(bc: BrokerClient): void {
    if (this.unsubMirror) return;
    this.unsubMirror = bridgeLink.onEvent((e) => {
      if (e.type !== "game_state") return;
      const { selfId, peers, spectatorCount } = useMpStore.getState();
      if (spectatorCount > 0 && selfId && hostRole(selfId, peers) === "host") {
        bc.sendMsg({ t: "spectate_state", state: e.state });
      }
    });
  }

  private _pushStateToSpectators(bc: BrokerClient): void {
    const { selfId, peers } = useMpStore.getState();
    if (!selfId || hostRole(selfId, peers) !== "host") return;
    const state = useStore.getState().gameState;
    if (state) bc.sendMsg({ t: "spectate_state", state });
  }

  private ensureRemoteMatch(): void {
    const { peers, selfId } = useMpStore.getState();
    if (this.rm || !this.pm || !selfId || peers.length === 0) return;
    const rm = new RemoteMatch({
      role: hostRole(selfId, peers),
      peer: this.pm,
      bridge: bridgeLink,
      applyState: (state) => useStore.getState().applyEvent({ type: "game_state", state }),
      selfCard: this.selfCard,
      onOpponentCard: (profile, summary) => {
        void resolveOpponentSummary(profile.id, summary).then((resolved) =>
          useMpStore.getState().setOpponentCard({ profile, summary: resolved }),
        );
      },
      onMatchId: (id) => useMpStore.getState().setRemoteMatchId(id),
      onChat: (text, name, ts) =>
        useMpStore.getState().addChatMessage({ self: false, name, text, ts }, { unread: true }),
      onTurnClock: (seconds) => useMpStore.getState().applyTurnClock(seconds),
    });
    rm.start();
    this.rm = rm;
    // Host announces its persisted turn-clock preference as soon as the match link exists.
    if (hostRole(selfId, peers) === "host") {
      const secs = useMpStore.getState().turnClockSecs;
      if (secs > 0) rm.setTurnClock(secs);
    }
  }

  startMatch(mode: string, options: Record<string, unknown>): void {
    if (!this.rm) return;
    const me = getOrCreatePlayer();
    const opponent = useMpStore.getState().peers[0]?.player.name ?? "Guest";
    this.rm.startGame(mode, [me.name, opponent], options);
  }

  requestAction(action: GuestAction, bed?: string): void { this.rm?.requestAction(action, bed); }

  /** Send a chat line to the peer and echo it into our own transcript. */
  sendChat(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || !this.rm) return;
    const me = getOrCreatePlayer();
    this.rm.sendChat(trimmed, me.name);
    useMpStore.getState().addChatMessage({ self: true, name: me.name, text: trimmed.slice(0, CHAT_MAX_LEN), ts: Date.now() });
  }

  /** Host: change the turn clock for this room (also persists the preference). */
  setTurnClock(seconds: number): void {
    useMpStore.getState().setTurnClockPref(seconds);
    this.rm?.setTurnClock(seconds);
  }

  leave(): void {
    this.broker?.leave(); this.broker?.close(); this.broker = null;
    this.pm?.closeAll(); this.pm = null;
    this.rm?.stop(); this.rm = null;
    this.unsubMirror?.(); this.unsubMirror = null;
    this.selfCard = null;
    useMpStore.getState().localStream?.getTracks().forEach((t) => t.stop());
    useMpStore.getState().resetMp();
  }
}

export const mpSession = new MpSession();
