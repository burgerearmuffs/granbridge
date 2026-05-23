/**
 * fetchIceServers — fetch short-lived TURN credentials from the broker's /turn
 * endpoint and build the RTCIceServer list. Falls back to STUN-only on any
 * failure so multiplayer still works (just without relay) if /turn is down.
 */
import { DEFAULT_ICE_SERVERS } from "./peerManager";

interface TurnPayload {
  username?: unknown;
  credential?: unknown;
  uris?: unknown;
}

function httpBase(brokerWsUrl: string): string {
  // ws:// -> http://, wss:// -> https://; strip trailing slashes
  return brokerWsUrl.replace(/^ws/, "http").replace(/\/+$/, "");
}

export async function fetchIceServers(brokerWsUrl: string): Promise<RTCIceServer[]> {
  try {
    const res = await fetch(httpBase(brokerWsUrl) + "/turn");
    if (!res.ok) return DEFAULT_ICE_SERVERS;
    const data = (await res.json()) as TurnPayload;
    if (
      !data ||
      !Array.isArray(data.uris) ||
      !data.uris.every((u) => typeof u === "string") ||
      typeof data.username !== "string" ||
      typeof data.credential !== "string"
    ) {
      return DEFAULT_ICE_SERVERS;
    }
    return [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: data.uris as string[], username: data.username, credential: data.credential },
    ];
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}
