/**
 * Bracket logic — creation (incl. byes), winner propagation, current match,
 * champion detection, validation.
 */
import { describe, it, expect } from "vitest";
import { createBracket, reportWinner, currentMatch, champion } from "./bracket";

describe("createBracket", () => {
  it("two players: one final match, no byes", () => {
    const b = createBracket(["A", "B"]);
    expect(b.rounds).toHaveLength(1);
    expect(b.rounds[0]).toHaveLength(1);
    expect(b.rounds[0][0]).toMatchObject({ p1: "A", p2: "B", winner: null });
  });

  it("four players: two semis + a final", () => {
    const b = createBracket(["A", "B", "C", "D"]);
    expect(b.rounds.map((r) => r.length)).toEqual([2, 1]);
    expect(b.rounds[0][0]).toMatchObject({ p1: "A", p2: "B" });
    expect(b.rounds[0][1]).toMatchObject({ p1: "C", p2: "D" });
  });

  it("three players: the bye auto-advances the first seed to the final", () => {
    const b = createBracket(["A", "B", "C"]);
    expect(b.rounds.map((r) => r.length)).toEqual([2, 1]);
    // A had the bye → already in the final
    expect(b.rounds[0][0]).toMatchObject({ p1: "A", p2: null, winner: "A" });
    expect(b.rounds[0][1]).toMatchObject({ p1: "B", p2: "C", winner: null });
    expect(b.rounds[1][0].p1).toBe("A");
  });

  it("six players: two byes, both auto-resolved", () => {
    const b = createBracket(["A", "B", "C", "D", "E", "F"]);
    expect(b.rounds.map((r) => r.length)).toEqual([4, 2, 1]);
    expect(b.rounds[0][0].winner).toBe("A");
    expect(b.rounds[0][1].winner).toBe("B");
    expect(b.rounds[1][0]).toMatchObject({ p1: "A", p2: "B" });
  });

  it("rejects bad input", () => {
    expect(() => createBracket(["A"])).toThrow(/player count/);
    expect(() => createBracket(Array.from({ length: 9 }, (_, i) => `P${i}`))).toThrow(/player count/);
    expect(() => createBracket(["A", " "])).toThrow(/blank/);
    expect(() => createBracket(["A", "A"])).toThrow(/unique/);
  });

  it("trims names", () => {
    const b = createBracket(["  Ann ", "Bo"]);
    expect(b.rounds[0][0].p1).toBe("Ann");
  });
});

describe("reportWinner / currentMatch / champion", () => {
  it("propagates winners through to a champion (4 players)", () => {
    let b = createBracket(["A", "B", "C", "D"]);
    expect(currentMatch(b)?.id).toBe("m0-0");
    b = reportWinner(b, "m0-0", "B");
    expect(currentMatch(b)?.id).toBe("m0-1");
    b = reportWinner(b, "m0-1", "C");
    expect(b.rounds[1][0]).toMatchObject({ p1: "B", p2: "C" });
    expect(champion(b)).toBeNull();
    b = reportWinner(b, "m1-0", "C");
    expect(champion(b)).toBe("C");
    expect(currentMatch(b)).toBeNull();
  });

  it("is immutable", () => {
    const b = createBracket(["A", "B"]);
    const b2 = reportWinner(b, "m0-0", "A");
    expect(b.rounds[0][0].winner).toBeNull();
    expect(b2.rounds[0][0].winner).toBe("A");
  });

  it("rejects winners not in the match and double-reporting", () => {
    let b = createBracket(["A", "B", "C", "D"]);
    expect(() => reportWinner(b, "m0-0", "C")).toThrow(/not in match/);
    expect(() => reportWinner(b, "nope", "A")).toThrow(/unknown match/);
    b = reportWinner(b, "m0-0", "A");
    expect(() => reportWinner(b, "m0-0", "B")).toThrow(/already decided/);
  });
});
