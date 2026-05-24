// ui/src/stats/statsClient.reads.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { brokerHttpBase, fetchPlayerSummary, fetchLeaderboard } from "./statsClient";

afterEach(() => vi.restoreAllMocks());

describe("brokerHttpBase", () => {
  it("maps ws->http and wss->https and strips trailing slash", () => {
    expect(brokerHttpBase("wss://darts.example.com/")).toBe("https://darts.example.com");
    expect(brokerHttpBase("ws://127.0.0.1:8788")).toBe("http://127.0.0.1:8788");
  });

  it("handles an uppercase scheme", () => {
    expect(brokerHttpBase("WSS://H/")).toBe("https://H");
  });
});

describe("reads", () => {
  it("fetchPlayerSummary hits /stats/player/{id} on the broker host", async () => {
    const body = { id: "P1", games_played: 2, wins: 1, three_dart_avg: 50, verified_games: 1, heatmap: {} };
    const f = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
    vi.stubGlobal("fetch", f);
    const out = await fetchPlayerSummary("P1", "https://h");
    expect(f).toHaveBeenCalledWith("https://h/stats/player/P1");
    expect(out.three_dart_avg).toBe(50);
  });

  it("fetchLeaderboard passes metric+limit and returns players", async () => {
    const body = { metric: "wins", players: [{ id: "P1", wins: 3 }] };
    const f = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
    vi.stubGlobal("fetch", f);
    const out = await fetchLeaderboard("wins", 5, "https://h");
    expect(f).toHaveBeenCalledWith("https://h/stats/leaderboard?metric=wins&limit=5");
    expect(out.players[0].id).toBe("P1");
  });

  it("throws on non-OK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchPlayerSummary("P1", "https://h")).rejects.toThrow();
  });
});
