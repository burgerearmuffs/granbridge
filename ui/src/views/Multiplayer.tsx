/**
 * Multiplayer view — join panel, video tiles, controls.
 *
 * Flow:
 *   1. User enters display name, room ID, password, broker URL → clicks Join.
 *   2. getLocalStream() is called (returns null in jsdom/SSR — guarded).
 *   3. BrokerClient is constructed and connect()ed.
 *   4. On 'joined': PeerManager is started; status → in_room.
 *   5. On leave: broker.leave(), PeerManager.closeAll(), status → idle.
 *
 * WebRTC APIs (RTCPeerConnection, getUserMedia) are always guarded in
 * peerManager.ts and media.ts — this component is safely render-testable.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useMpStore } from "../multiplayer/store";
import { getOrCreatePlayer, setPlayerName } from "../multiplayer/player";
import { BrokerClient } from "../multiplayer/brokerClient";
import type { PeerInfo } from "../multiplayer/brokerClient";
import { PeerManager } from "../multiplayer/peerManager";
import { getLocalStream } from "../multiplayer/media";
import { VideoTile } from "../components/VideoTile";
import { MpControls } from "../components/MpControls";

// keyed by broker peer_id
type StreamMap = Map<string, MediaStream>;

export function Multiplayer() {
  const mpStatus = useMpStore((s) => s.mpStatus);
  const room = useMpStore((s) => s.room);
  const peers = useMpStore((s) => s.peers);
  const error = useMpStore((s) => s.error);
  const mic = useMpStore((s) => s.mic);
  const cam = useMpStore((s) => s.cam);
  const brokerUrl = useMpStore((s) => s.brokerUrl);
  const { setMpStatus, setRoom, setSelfId, setPeers, setError, setBrokerUrl, resetMp } = useMpStore.getState();

  const identity = getOrCreatePlayer();
  const [displayName, setDisplayName] = useState(identity.name);
  const [roomInput, setRoomInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [brokerInput, setBrokerInput] = useState(brokerUrl);

  // Local stream + remote streams
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<StreamMap>(new Map());

  // Refs — stable across renders
  const brokerRef = useRef<BrokerClient | null>(null);
  const pmRef = useRef<PeerManager | null>(null);

  // Update local tracks when mic/cam toggles change
  useEffect(() => {
    if (!localStream) return;
    for (const track of localStream.getAudioTracks()) track.enabled = mic;
    for (const track of localStream.getVideoTracks()) track.enabled = cam;
  }, [mic, cam, localStream]);

  const handleJoin = useCallback(async () => {
    if (!roomInput.trim() || !passwordInput.trim()) return;

    setError(undefined);
    setMpStatus("connecting");
    setRoom(roomInput.trim());

    // Persist updated display name
    const player = setPlayerName(displayName.trim() || identity.name);

    // Save broker URL preference
    if (brokerInput.trim()) setBrokerUrl(brokerInput.trim());

    // Get local media (null in jsdom — guarded)
    const stream = await getLocalStream({ video: cam, audio: mic });
    setLocalStream(stream);

    // Construct broker client
    const bc = new BrokerClient(brokerInput.trim() || "ws://127.0.0.1:8788");
    brokerRef.current = bc;

    bc.onJoined((self: PeerInfo, initialPeers: PeerInfo[]) => {
      setSelfId(self.peer_id);
      setPeers(initialPeers);
      setMpStatus("in_room");

      // Start peer manager
      const pm = new PeerManager(bc, self.peer_id, stream);
      pmRef.current = pm;

      pm.onRemoteStream = (peerId, rs) => {
        setRemoteStreams((prev) => new Map(prev).set(peerId, rs));
      };
      pm.onPeerState = (_peerId, state) => {
        if (state === "failed") setError(`Peer connection failed`);
      };

      // Feed initial peers into PeerManager
      if (initialPeers.length > 0) {
        bc.onPeers((latestPeers: PeerInfo[]) => setPeers(latestPeers));
      }
    });

    bc.onPeers((latestPeers: PeerInfo[]) => setPeers(latestPeers));

    bc.onError((code, message) => {
      setError(`${code}: ${message}`);
      setMpStatus("error");
    });

    bc.onClose(() => {
      if (useMpStore.getState().mpStatus === "in_room") {
        setMpStatus("error");
        setError("Disconnected from broker");
      }
    });

    bc.connect();
    bc.join(roomInput.trim(), passwordInput.trim(), { id: player.id, name: player.name });
  }, [roomInput, passwordInput, displayName, brokerInput, cam, mic, identity.name,
      setBrokerUrl, setError, setMpStatus, setPeers, setRoom, setSelfId]);

  const handleLeave = useCallback(() => {
    brokerRef.current?.leave();
    brokerRef.current?.close();
    brokerRef.current = null;

    pmRef.current?.closeAll();
    pmRef.current = null;

    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setRemoteStreams(new Map());
    resetMp();
  }, [localStream, resetMp]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (mpStatus === "idle" || mpStatus === "error") {
    return (
      <div className="max-w-md mx-auto mt-8 space-y-4">
        <h2 className="text-2xl font-bold">Multiplayer (beta)</h2>
        <p className="text-neutral-400 text-sm">
          Join a room to play darts with a friend over camera+mic.
        </p>

        {error && (
          <div role="alert" className="bg-red-900/60 border border-red-700 rounded-lg px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <label className="block">
            <span className="text-sm text-neutral-300">Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full bg-neutral-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Your name"
              aria-label="Display name"
            />
          </label>

          <label className="block">
            <span className="text-sm text-neutral-300">Room ID</span>
            <input
              type="text"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              className="mt-1 w-full bg-neutral-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="e.g. friday-night"
              aria-label="Room ID"
            />
          </label>

          <label className="block">
            <span className="text-sm text-neutral-300">Password</span>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              className="mt-1 w-full bg-neutral-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Room password"
              aria-label="Password"
            />
          </label>

          <label className="block">
            <span className="text-sm text-neutral-300">Broker URL</span>
            <input
              type="text"
              value={brokerInput}
              onChange={(e) => setBrokerInput(e.target.value)}
              className="mt-1 w-full bg-neutral-800 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="ws://127.0.0.1:8788"
              aria-label="Broker URL"
            />
          </label>

          <button
            onClick={handleJoin}
            disabled={!roomInput.trim() || !passwordInput.trim()}
            className="w-full py-2.5 rounded-lg bg-amber-400 text-neutral-900 font-bold text-sm hover:bg-amber-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Join room"
          >
            {mpStatus === "error" ? "Retry" : "Join"}
          </button>
        </div>
      </div>
    );
  }

  if (mpStatus === "connecting") {
    return (
      <div className="max-w-md mx-auto mt-8 text-center">
        <p className="text-neutral-400 animate-pulse">Connecting to {room}…</p>
      </div>
    );
  }

  // in_room
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">
          Room: <span className="text-amber-400">{room}</span>
        </h2>
        <span className="text-sm text-neutral-400">{peers.length + 1} player{peers.length !== 0 ? "s" : ""}</span>
      </div>

      {/* Video grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Local tile — always muted */}
        <VideoTile
          stream={localStream}
          label={`${displayName} (you)`}
          muted
          micActive={mic}
          camActive={cam}
        />
        {/* Remote tiles */}
        {peers.map((p) => (
          <VideoTile
            key={p.peer_id}
            stream={remoteStreams.get(p.peer_id) ?? null}
            label={p.player.name}
            muted={false}
          />
        ))}
      </div>

      {/* Peer list */}
      {peers.length === 0 && (
        <p className="text-neutral-500 text-sm">Waiting for opponent to join…</p>
      )}

      <MpControls onLeave={handleLeave} />
    </div>
  );
}
