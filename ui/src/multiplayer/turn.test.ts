// ui/src/multiplayer/turn.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchIceServers } from "./turn";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const STUN = "stun:stun.l.google.com:19302";

describe("fetchIceServers", () => {
  it("derives the https base and merges the TURN server on success", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        username: "123", credential: "abc",
        uris: ["turn:d:3478?transport=udp", "turns:d:5349?transport=tcp"],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const servers = await fetchIceServers("wss://play.example.com");

    expect(fetchMock).toHaveBeenCalledWith("https://play.example.com/turn");
    expect(servers[0]).toEqual({ urls: STUN });
    expect(servers[1]).toEqual({
      urls: ["turn:d:3478?transport=udp", "turns:d:5349?transport=tcp"],
      username: "123", credential: "abc",
    });
  });

  it("maps ws:// to http:// for the credential fetch", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    await fetchIceServers("ws://127.0.0.1:8788");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8788/turn");
  });

  it("falls back to STUN-only on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })) as unknown as typeof fetch);
    const servers = await fetchIceServers("wss://d");
    expect(servers).toEqual([{ urls: STUN }]);
  });

  it("falls back to STUN-only when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }) as unknown as typeof fetch);
    const servers = await fetchIceServers("wss://d");
    expect(servers).toEqual([{ urls: STUN }]);
  });

  it("falls back to STUN-only on a malformed payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ username: "x" }) })) as unknown as typeof fetch);
    const servers = await fetchIceServers("wss://d");
    expect(servers).toEqual([{ urls: STUN }]);
  });
});
