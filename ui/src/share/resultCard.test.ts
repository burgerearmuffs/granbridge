/**
 * Result sharing — text builder + summary distillation. Canvas drawing returns
 * null under jsdom (getContext stubbed to null) and that path is asserted too.
 */
import { describe, it, expect } from "vitest";
import { buildResultText, summarizeResult, drawResultCard, downloadResultCard } from "./resultCard";
import type { GameState } from "../types";

const FINISHED: GameState = {
  mode: "x01", status: "finished",
  players: [{ id: "p1", name: "Ann" }, { id: "p2", name: "Bo" }],
  active_index: 0, visit: [], legs: { p1: 2, p2: 1 }, sets: {},
  winner: "p1",
  options: { start_score: 501, double_out: true, best_of_legs: 3 },
  mode_view: {},
  stats: {
    p1: { darts: 45, total_scored: 813, three_dart_avg: 54.2 },
    p2: { darts: 42, total_scored: 698, three_dart_avg: 49.857 },
  },
};

describe("summarizeResult", () => {
  it("labels x01 with the start score and resolves the winner name", () => {
    const s = summarizeResult(FINISHED);
    expect(s.modeLabel).toBe("X01 501");
    expect(s.winnerName).toBe("Ann");
    expect(s.lines).toEqual([
      { name: "Ann", legs: 2, avg: 54.2, darts: 45 },
      { name: "Bo", legs: 1, avg: 49.857, darts: 42 },
    ]);
  });

  it("handles missing stats/legs and unknown modes defensively", () => {
    const s = summarizeResult({
      ...FINISHED, mode: "weird", options: {}, legs: {}, stats: {}, winner: null,
    });
    expect(s.modeLabel).toBe("weird");
    expect(s.winnerName).toBeNull();
    expect(s.lines[0]).toEqual({ name: "Ann", legs: 0, avg: 0, darts: 0 });
  });
});

describe("buildResultText", () => {
  it("renders a compact shareable summary", () => {
    const text = buildResultText(FINISHED);
    expect(text).toContain("🎯 GRANBRIDGE — X01 501");
    expect(text).toContain("🏆 Ann wins");
    expect(text).toContain("Ann: 2 legs · 54.2 three-dart avg (45 darts)");
    expect(text).toContain("Bo: 1 leg · 49.9 three-dart avg (42 darts)");
  });

  it("omits leg counts when no legs were recorded", () => {
    const text = buildResultText({ ...FINISHED, legs: {} });
    expect(text).toContain("Ann: 54.2 three-dart avg (45 darts)");
    expect(text).not.toContain("legs ·");
  });
});

describe("canvas paths under jsdom", () => {
  it("drawResultCard returns null without a 2D context and download reports failure", () => {
    expect(drawResultCard(FINISHED)).toBeNull();
    expect(downloadResultCard(FINISHED)).toBe(false);
  });
});
