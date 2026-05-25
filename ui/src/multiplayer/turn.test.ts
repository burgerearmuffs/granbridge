// ui/src/multiplayer/turn.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchIceServers } from "./turn";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("fetchIceServers", () => {
  it("returns a relay-only TURNS server on success (no STUN)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        username: "123", credential: "abc",
        uris: ["turns:play.example.com:443?transport=tcp"],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const servers = await fetchIceServers("wss://play.example.com");

    expect(fetchMock).toHaveBeenCalledWith("https://play.example.com/turn");
    expect(servers).toEqual([{
      urls: ["turns:play.example.com:443?transport=tcp"],
      username: "123", credential: "abc",
    }]);
  });

  it("maps ws:// to http:// for the credential fetch", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    await fetchIceServers("ws://127.0.0.1:8788");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8788/turn");
  });

  it("returns [] on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })) as unknown as typeof fetch);
    expect(await fetchIceServers("wss://d")).toEqual([]);
  });

  it("returns [] when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }) as unknown as typeof fetch);
    expect(await fetchIceServers("wss://d")).toEqual([]);
  });

  it("returns [] on a malformed payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ username: "x" }) })) as unknown as typeof fetch);
    expect(await fetchIceServers("wss://d")).toEqual([]);
  });

  it("returns [] when uris contains a non-string element", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ username: "x", credential: "y", uris: ["turns:d:443", 42] }) })) as unknown as typeof fetch);
    expect(await fetchIceServers("wss://d")).toEqual([]);
  });

  it("returns [] when uris is an empty array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ username: "x", credential: "y", uris: [] }) })) as unknown as typeof fetch);
    expect(await fetchIceServers("wss://d")).toEqual([]);
  });
});
