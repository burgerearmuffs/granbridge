import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { useMpStore } from "../multiplayer/store";
import { getOrCreatePlayer } from "../multiplayer/player";
import { getUploadEnabled } from "./uploadPref";
import { enqueue } from "./statsQueue";
import type { GameState } from "../types";
import type { Identity, MatchRecord } from "./types";

/**
 * Watches the game store; when a game transitions to "finished", assembles a
 * MatchRecord and enqueues it for upload (gated by the upload toggle). Two paths:
 * remote (aggregate from the snapshot, shared match_id) vs local (full throws
 * from the app's export/latest, my-slice only).
 */
export function useStatsSubmission(): void {
  const gameState = useStore((s) => s.gameState);
  const prevStatus = useRef<string | null>(null);
  const startedAt = useRef<string | null>(null);

  useEffect(() => {
    const status = gameState?.status ?? null;
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (prev !== "in_progress" && status === "in_progress") {
      startedAt.current = new Date().toISOString();
    }
    if (prev !== "finished" && status === "finished" && gameState) {
      void onFinished(gameState, startedAt.current);
    }
  }, [gameState]);
}

async function onFinished(state: GameState, startedAtIso: string | null): Promise<void> {
  if (!getUploadEnabled()) return;
  const me = getOrCreatePlayer();
  const identity: Identity = { id: me.id, writeToken: me.writeToken, name: me.name, avatarColor: me.avatar.color };
  const mp = useMpStore.getState();

  if (mp.remoteMatchId && mp.peers.length > 0) {
    const opp = mp.peers[0].player;
    const mine = state.stats[me.name] ?? { darts: 0, total_scored: 0 };
    const winner_id = state.winner === me.name ? me.id : state.winner === opp.name ? opp.id : null;
    const record: MatchRecord = {
      match_id: mp.remoteMatchId, mode: state.mode, opponent_id: opp.id, winner_id,
      is_remote: true, darts: mine.darts, total_scored: mine.total_scored,
      started_at: startedAtIso ?? new Date().toISOString(), ended_at: new Date().toISOString(),
    };
    enqueue({ record, identity });
    return;
  }

  // LOCAL: pull the canonical match from the app and take my slice.
  let data: {
    mode: string; players: string[]; winner: string | null; started_at: string; ended_at: string;
    throws: { player: string; bed: string; score: number; ts: string }[];
  };
  try {
    const res = await fetch("/api/history/export/latest");
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return;
  }
  if (!data || !Array.isArray(data.players) || !data.players.includes(me.name)) return; // hotseat skip
  const mine = (data.throws ?? []).filter((t) => t.player === me.name);
  const record: MatchRecord = {
    match_id: crypto.randomUUID(), mode: data.mode, opponent_id: null,
    winner_id: data.winner === me.name ? me.id : null,
    is_remote: false, darts: mine.length, total_scored: mine.reduce((s, t) => s + t.score, 0),
    started_at: data.started_at, ended_at: data.ended_at,
    throws: mine.map((t) => ({ bed: t.bed, score: t.score, ts: t.ts })),
  };
  enqueue({ record, identity });
}
