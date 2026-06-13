import { describe, it, expect } from "vitest";
import { videoForEvent } from "./decide";

describe("videoForEvent", () => {
  it("game_won → 'game-won'", () => {
    expect(videoForEvent("game_won")).toBe("game-won");
  });

  it("leg_won → 'leg-won'", () => {
    expect(videoForEvent("leg_won")).toBe("leg-won");
  });

  it("bust → null", () => {
    expect(videoForEvent("bust")).toBeNull();
  });

  it("dart_hit → null", () => {
    expect(videoForEvent("dart_hit")).toBeNull();
  });

  it("game_state → null", () => {
    expect(videoForEvent("game_state")).toBeNull();
  });

  it("empty string → null", () => {
    expect(videoForEvent("")).toBeNull();
  });

  it("unknown kind → null", () => {
    expect(videoForEvent("something_else")).toBeNull();
  });

  it("is case-sensitive: Game_Won → null", () => {
    expect(videoForEvent("Game_Won")).toBeNull();
  });
});

describe("announceForHit", () => {
  it("announces high trebles and the double bull only", async () => {
    const { announceForHit } = await import("./decide");
    expect(announceForHit("T20")).toBe("treble-twenty");
    expect(announceForHit("T19")).toBe("treble-nineteen");
    expect(announceForHit("T18")).toBe("treble-eighteen");
    expect(announceForHit("DBULL")).toBe("bullseye");
    for (const bed of ["T17", "BULL", "S20", "D20", "MISS"]) {
      expect(announceForHit(bed)).toBeNull();
    }
  });
});
