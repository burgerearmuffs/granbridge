import { readBrokerUrl } from "../multiplayer/store";
import type { PlayerSummary, LeaderRow } from "./types";

/** Map the broker WS URL to its HTTP origin (ws->http, wss->https; trailing slash stripped). */
export function brokerHttpBase(wsUrl: string = readBrokerUrl()): string {
  let base = wsUrl.trim();
  if (base.startsWith("wss://")) base = "https://" + base.slice(6);
  else if (base.startsWith("ws://")) base = "http://" + base.slice(5);
  return base.replace(/\/+$/, "");
}

export async function fetchPlayerSummary(id: string, base: string = brokerHttpBase()): Promise<PlayerSummary> {
  const res = await fetch(`${base}/stats/player/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`stats/player ${res.status}`);
  return (await res.json()) as PlayerSummary;
}

export async function fetchLeaderboard(
  metric: "avg" | "wins", limit = 20, base: string = brokerHttpBase(),
): Promise<{ metric: string; players: LeaderRow[] }> {
  const res = await fetch(`${base}/stats/leaderboard?metric=${metric}&limit=${limit}`);
  if (!res.ok) throw new Error(`stats/leaderboard ${res.status}`);
  return (await res.json()) as { metric: string; players: LeaderRow[] };
}
