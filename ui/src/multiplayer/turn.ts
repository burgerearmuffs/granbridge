/**
 * fetchIceServers — fetch short-lived TURN credentials from the broker's /turn
 * endpoint and build a relay-only RTCIceServer list (a single TURNS server).
 * Returns [] on any failure: relay-only multiplayer needs the broker's TURNS
 * server, so there is no useful STUN fallback.
 */
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
    if (!res.ok) return [];
    const data = (await res.json()) as TurnPayload;
    if (
      !data ||
      !Array.isArray(data.uris) ||
      !data.uris.every((u) => typeof u === "string") ||
      typeof data.username !== "string" ||
      typeof data.credential !== "string"
    ) {
      return [];
    }
    return [{ urls: data.uris as string[], username: data.username, credential: data.credential }];
  } catch {
    return [];
  }
}
