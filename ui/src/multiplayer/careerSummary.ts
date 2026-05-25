/**
 * CareerSummary — the small per-player stat card sourced from the bridge's
 * existing /api/history/stats endpoint (rows keyed by display name).
 */
import { apiBase } from "../apiBase";

export interface CareerSummary {
  threeDartAvg: number;
  wins: number;
  gamesPlayed: number;
}

const ZERO: CareerSummary = { threeDartAvg: 0, wins: 0, gamesPlayed: 0 };

interface StatRow {
  player: string;
  three_dart_avg: number;
  wins: number;
  games_played: number;
}

/** Fetch /api/history/stats and return the summary for `name` (zeros on miss/error). */
export async function fetchMyCareerSummary(name: string, base = apiBase()): Promise<CareerSummary> {
  try {
    const res = await fetch(`${base}/api/history/stats`);
    if (!res.ok) return ZERO;
    const rows = (await res.json()) as StatRow[];
    const row = rows.find((r) => r.player === name);
    if (!row) return ZERO;
    return { threeDartAvg: row.three_dart_avg, wins: row.wins, gamesPlayed: row.games_played };
  } catch {
    return ZERO;
  }
}
