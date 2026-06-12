/**
 * Multiplayer view — join panel, video tiles, controls.
 *
 * Flow:
 *   1. User enters display name, room ID, password, broker URL → clicks Join.
 *   2. mpSession.join() is called — acquires media, connects broker, starts PM/RM.
 *   3. Reactive state (localStream, remoteStreams, opponentCard, connectionHealth)
 *      is read directly from useMpStore (populated by mpSession).
 *   4. On leave: mpSession.leave() stops broker/PM/RM and resets the store.
 *   5. Tab switches do NOT tear down the session — mpSession is module-scoped.
 *
 * WebRTC APIs (RTCPeerConnection, getUserMedia) are always guarded in
 * peerManager.ts and media.ts — this component is safely render-testable.
 */

import { useState, useEffect, useCallback } from "react";
import { useMpStore } from "../multiplayer/store";
import { getOrCreatePlayer } from "../multiplayer/player";
import { VideoTile } from "../components/VideoTile";
import { MpControls } from "../components/MpControls";
import { MpGameLayout } from "../components/MpGameLayout";
import { useStore } from "../store";
import { LiveGame } from "./LiveGame";
import { OpponentCard } from "../components/OpponentCard";
import { defaultAvatarColor } from "../multiplayer/avatar";
import { mpSession } from "../multiplayer/session";
import { hostRole } from "../multiplayer/remoteMatch";
import { GuestControls } from "../components/GuestControls";
import { ChatPanel } from "../components/ChatPanel";
import { TurnClock } from "../components/TurnClock";

export function Multiplayer() {
  const mpStatus = useMpStore((s) => s.mpStatus);
  const room = useMpStore((s) => s.room);
  const peers = useMpStore((s) => s.peers);
  const error = useMpStore((s) => s.error);
  const mediaNotice = useMpStore((s) => s.mediaNotice);
  const mic = useMpStore((s) => s.mic);
  const cam = useMpStore((s) => s.cam);
  const brokerUrl = useMpStore((s) => s.brokerUrl);
  const selfId = useMpStore((s) => s.selfId);
  const localStream = useMpStore((s) => s.localStream);
  const remoteStreams = useMpStore((s) => s.remoteStreams);
  const connectionHealth = useMpStore((s) => s.connectionHealth);
  const opponentCard = useMpStore((s) => s.opponentCard);
  const turnClockSecs = useMpStore((s) => s.turnClockSecs);
  const gameState = useStore((s) => s.gameState);

  const identity = getOrCreatePlayer();
  const [displayName, setDisplayName] = useState(identity.name);
  const [roomInput, setRoomInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [brokerInput, setBrokerInput] = useState(brokerUrl);
  const [mpMode, setMpMode] = useState("x01");

  // Update local tracks when mic/cam toggles change
  useEffect(() => {
    if (!localStream) return;
    for (const track of localStream.getAudioTracks()) track.enabled = mic;
    for (const track of localStream.getVideoTracks()) track.enabled = cam;
  }, [mic, cam, localStream]);

  const handleJoin = useCallback(() => {
    if (!roomInput.trim() || !passwordInput.trim()) return;
    void mpSession.join({ room: roomInput.trim(), password: passwordInput.trim(),
      displayName: displayName.trim() || identity.name, brokerUrl: brokerInput.trim() });
  }, [roomInput, passwordInput, displayName, brokerInput, identity.name]);

  const handleLeave = useCallback(() => mpSession.leave(), []);

  const handleStartMatch = useCallback(() => {
    const options = mpMode === "x01" ? { start_score: 501, double_out: true } : {};
    mpSession.startMatch(mpMode, options);
  }, [mpMode]);

  // Role is derived deterministically from peer ids (host = smaller id)
  const role = selfId && peers.length ? hostRole(selfId, peers) : null;

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

  // Shared video tile elements (used in both lobby and in-game layout)
  const localVideoTile = (
    <VideoTile
      stream={localStream}
      label={`${displayName} (you)`}
      muted
      micActive={mic}
      camActive={cam}
      avatarName={displayName}
      avatarColor={identity.avatar.color}
    />
  );

  const firstPeer = peers[0];
  const firstRemoteVideoTile = firstPeer ? (
    <VideoTile
      key={firstPeer.peer_id}
      stream={remoteStreams.get(firstPeer.peer_id) ?? null}
      label={firstPeer.player.name}
      muted={false}
      avatarName={firstPeer.player.name}
      avatarColor={firstPeer.player.avatar?.color ?? defaultAvatarColor(firstPeer.player.id)}
    />
  ) : null;

  // Connection health banners (shown in both lobby and in-game)
  const healthBanners = (
    <>
      {mediaNotice && (
        <div role="status" className="flex items-start gap-2 bg-amber-900/50 border border-amber-700 rounded-lg px-4 py-2 text-sm text-amber-200">
          <span className="flex-1">{mediaNotice}</span>
          <button
            onClick={() => useMpStore.getState().setMediaNotice(undefined)}
            aria-label="Dismiss camera notice"
            className="text-amber-300 hover:text-amber-100 font-bold"
          >
            ×
          </button>
        </div>
      )}
      {connectionHealth === "reconnecting" && (
        <div role="status" className="bg-amber-900/50 border border-amber-700 rounded-lg px-4 py-2 text-sm text-amber-200">
          Reconnecting…
        </div>
      )}
      {connectionHealth === "lost" && (
        <div role="alert" className="bg-red-900/60 border border-red-700 rounded-lg px-4 py-2 text-sm text-red-200">
          Connection lost. <button onClick={handleJoin} className="underline">Rejoin</button>
        </div>
      )}
    </>
  );

  // ── In-progress: broadcast-rail layout ──────────────────────────────────────
  if (gameState && gameState.status === "in_progress") {
    const guestActionControls = role === "guest" ? (
      <GuestControls
        state={gameState}
        guestSlot="p2"
        onAction={(a, bed) => mpSession.requestAction(a, bed)}
      />
    ) : null;

    return (
      <div className="space-y-2">
        {/* Slim room header bar */}
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold text-neutral-400">
            Room: <span className="text-amber-400">{room}</span>
          </h2>
          <div className="flex items-center gap-3">
            <TurnClock
              seconds={turnClockSecs}
              resetKey={`${gameState.active_index}:${JSON.stringify(gameState.legs ?? {})}`}
              running={gameState.status === "in_progress"}
            />
            <span className="text-xs text-neutral-500">{peers.length + 1} player{peers.length !== 0 ? "s" : ""}</span>
          </div>
        </div>

        {healthBanners}

        <MpGameLayout
          board={<LiveGame state={gameState} />}
          selfVideo={localVideoTile}
          oppVideo={firstRemoteVideoTile ?? <div className="w-full h-full bg-neutral-800 rounded-lg flex items-center justify-center text-neutral-500 text-xs">No opponent camera</div>}
          oppCard={opponentCard ? <OpponentCard profile={opponentCard.profile} summary={opponentCard.summary} /> : null}
          controls={
            <div className="space-y-2">
              <ChatPanel />
              {guestActionControls}
              <MpControls onLeave={handleLeave} />
            </div>
          }
        />
      </div>
    );
  }

  // ── Lobby: pre-game stacked layout ─────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">
          Room: <span className="text-amber-400">{room}</span>
        </h2>
        <span className="text-sm text-neutral-400">{peers.length + 1} player{peers.length !== 0 ? "s" : ""}</span>
      </div>

      {healthBanners}

      {/* Video grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Local tile — always muted */}
        {localVideoTile}
        {/* Remote tiles */}
        {peers.map((p) => (
          <VideoTile
            key={p.peer_id}
            stream={remoteStreams.get(p.peer_id) ?? null}
            label={p.player.name}
            muted={false}
            avatarName={p.player.name}
            avatarColor={p.player.avatar?.color ?? defaultAvatarColor(p.player.id)}
          />
        ))}
      </div>

      {opponentCard && (
        <OpponentCard profile={opponentCard.profile} summary={opponentCard.summary} />
      )}

      {/* Peer list */}
      {peers.length === 0 && (
        <p className="text-neutral-500 text-sm">Waiting for opponent to join…</p>
      )}

      {/* In-room chat — available as soon as you're connected */}
      <ChatPanel startOpen />

      {/* Shared match — lobby controls */}
      <div className="border-t border-neutral-800 pt-4">
        {role === "host" ? (
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm text-neutral-300">
              Mode
              <select
                value={mpMode}
                onChange={(e) => setMpMode(e.target.value)}
                aria-label="Match mode"
                className="ml-2 bg-neutral-800 rounded-lg px-3 py-2 text-sm"
              >
                <option value="x01">X01 (501)</option>
                <option value="cricket">Cricket</option>
                <option value="around_the_clock">Around the Clock</option>
                <option value="count_up">Count-Up</option>
                <option value="medley">Medley</option>
              </select>
            </label>
            <label className="text-sm text-neutral-300">
              Turn clock
              <select
                value={String(turnClockSecs)}
                onChange={(e) => mpSession.setTurnClock(Number(e.target.value))}
                aria-label="Turn clock"
                className="ml-2 bg-neutral-800 rounded-lg px-3 py-2 text-sm"
              >
                <option value="0">Off</option>
                <option value="30">30s</option>
                <option value="45">45s</option>
                <option value="60">60s</option>
              </select>
            </label>
            <button
              onClick={handleStartMatch}
              disabled={peers.length === 0}
              className="px-4 py-2 rounded-lg bg-amber-400 text-neutral-900 font-bold text-sm hover:bg-amber-300 disabled:opacity-40"
              aria-label="Start match"
            >
              Start match
            </button>
          </div>
        ) : role === "guest" && gameState ? (
          <GuestControls state={gameState} guestSlot="p2" onAction={(a, bed) => mpSession.requestAction(a, bed)} />
        ) : (
          <p className="text-neutral-500 text-sm">Waiting for the host to start the match…</p>
        )}
      </div>

      <MpControls onLeave={handleLeave} />
    </div>
  );
}
