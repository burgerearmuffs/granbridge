import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchMyCareerSummary } from "./careerSummary";

afterEach(() => { vi.restoreAllMocks(); });

function mockFetch(rows: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(rows),
  }));
}

describe("fetchMyCareerSummary", () => {
  it("maps the row matching the player name", async () => {
    mockFetch([
      { player: "Ada", three_dart_avg: 62.5, wins: 3, games_played: 7 },
      { player: "Bob", three_dart_avg: 40, wins: 1, games_played: 4 },
    ]);
    const s = await fetchMyCareerSummary("Ada");
    expect(s).toEqual({ threeDartAvg: 62.5, wins: 3, gamesPlayed: 7 });
  });

  it("returns zeros when no row matches", async () => {
    mockFetch([{ player: "Bob", three_dart_avg: 40, wins: 1, games_played: 4 }]);
    expect(await fetchMyCareerSummary("Ada")).toEqual({ threeDartAvg: 0, wins: 0, gamesPlayed: 0 });
  });

  it("returns zeros on a failed request", async () => {
    mockFetch([], false);
    expect(await fetchMyCareerSummary("Ada")).toEqual({ threeDartAvg: 0, wins: 0, gamesPlayed: 0 });
  });

  it("returns zeros when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await fetchMyCareerSummary("Ada")).toEqual({ threeDartAvg: 0, wins: 0, gamesPlayed: 0 });
  });
});
