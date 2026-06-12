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

export interface JoinOpts { room: string; password: string; displayName: string; brokerUrl: string; }

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

  async join(opts: JoinOpts): Promise<void> {
    const store = useMpStore.getState();
    if (store.mpStatus === "connecting" || store.mpStatus === "in_room") return; // idempotent
    store.setError(undefined);
    store.setMpStatus("connecting");
    store.setRoom(opts.room);

    const { mic, cam, camDeviceId, micDeviceId } = useMpStore.getState();
    const player = setPlayerName(opts.displayName.trim() || getOrCreatePlayer().name);
    if (opts.brokerUrl.trim()) store.setBrokerUrl(opts.brokerUrl.trim());

    const { stream, failure } = await acquireLocalMedia(
      buildConstraints(cam, mic, camDeviceId, micDeviceId),
    );
    useMpStore.getState().setLocalStream(stream);
    useMpStore.getState().setMediaNotice(mediaNoticeFor(failure));

    this.selfCard = { profile: player, summary: await fetchMyCareerSummary(player.name) };

    const url = opts.brokerUrl.trim() || useMpStore.getState().brokerUrl;
    const iceServers = await fetchIceServers(url);

    const bc = new BrokerClient(url);
    this.broker = bc;

    bc.onJoined((self: string, initialPeers: PeerInfo[]) => {
      const s = useMpStore.getState();
      s.setSelfId(self);
      s.setPeers(initialPeers);
      s.setMpStatus("in_room");

      const pm = new PeerManager(bc, self, stream, iceServers);
      this.pm = pm;
      pm.onRemoteStream = (peerId, rs) => useMpStore.getState().setRemoteStream(peerId, rs);
      pm.onConnectionHealth = (_peerId, health) => useMpStore.getState().setConnectionHealth(health);
      this.ensureRemoteMatch();
    });

    bc.onPeers((latest: PeerInfo[]) => { useMpStore.getState().setPeers(latest); this.ensureRemoteMatch(); });
    bc.onError((code, message) => { const s = useMpStore.getState(); s.setError(`${code}: ${message}`); s.setMpStatus("error"); });
    bc.onClose(() => { const s = useMpStore.getState(); if (s.mpStatus === "in_room") { s.setMpStatus("error"); s.setError("Disconnected from broker"); } });

    bc.connect();
    bc.join(opts.room, opts.password, { id: player.id, name: player.name, avatar: player.avatar });
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
    this.selfCard = null;
    useMpStore.getState().localStream?.getTracks().forEach((t) => t.stop());
    useMpStore.getState().resetMp();
  }
}

export const mpSession = new MpSession();
