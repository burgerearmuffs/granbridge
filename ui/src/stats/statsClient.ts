import { readBrokerUrl } from "../multiplayer/store";
import type { PlayerSummary, LeaderRow, MatchRecord, Identity } from "./types";
import type { CareerSummary } from "../multiplayer/careerSummary";

/** Map the broker's PlayerSummary to the UI's CareerSummary (defensive on missing fields). */
export function toCareerSummary(s: PlayerSummary): CareerSummary {
  return {
    threeDartAvg: s?.three_dart_avg ?? 0,
    wins: s?.wins ?? 0,
    gamesPlayed: s?.games_played ?? 0,
  };
}

/** Map the broker WS URL to its HTTP origin (ws->http, wss->https; trailing slash stripped). */
export function brokerHttpBase(wsUrl: string = readBrokerUrl()): string {
  const base = wsUrl.trim();
  const lower = base.toLowerCase();
  if (lower.startsWith("wss://")) return ("https://" + base.slice(6)).replace(/\/+$/, "");
  if (lower.startsWith("ws://")) return ("http://" + base.slice(5)).replace(/\/+$/, "");
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

/** Submit a match over a transient WebSocket; resolves on stats_ack, rejects Error(code) otherwise. */
export function submitMatch(
  record: MatchRecord, identity: Identity,
  wsUrl: string = readBrokerUrl(), timeoutMs = 8000,
): Promise<{ match_id: string; verified: boolean }> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      reject(e instanceof Error ? e : new Error("ws_construct"));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("timeout"))), timeoutMs);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "stats_submit",
        id: identity.id,
        writeToken: identity.writeToken,
        player: { id: identity.id, name: identity.name, avatar: { color: identity.avatarColor } },
        match: record,
      }));
    };
    ws.onmessage = (ev: MessageEvent) => {
      let msg: { type?: string; match_id?: string; verified?: boolean; code?: string };
      try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : ""); }
      catch { return; } // ignore non-JSON / partial frame; wait for the next message or the timeout
      if (msg.type === "stats_ack") finish(() => resolve({ match_id: msg.match_id ?? record.match_id, verified: !!msg.verified }));
      else if (msg.type === "error") finish(() => reject(new Error(msg.code || "error")));
    };
    ws.onerror = () => finish(() => reject(new Error("ws_error")));
    ws.onclose = () => finish(() => reject(new Error("closed")));
  });
}
