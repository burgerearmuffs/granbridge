import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MedleyBoard } from "./MedleyBoard";
import type { GameState } from "../../types";

function baseState(): GameState {
  return {
    mode: "medley", status: "in_progress",
    players: [{ id: "p1", name: "Ann" }, { id: "p2", name: "Bo" }],
    active_index: 0, visit: [], legs: { p1: 0, p2: 0 }, sets: {}, winner: null,
    options: {}, mode_view: {}, stats: {},
  };
}

describe("MedleyBoard", () => {
  it("shows the medley header and delegates to the X01 sub-board", () => {
    const s = baseState();
    s.mode_view = { scores: { p1: 421, p2: 501 }, medley: { sequence: ["x01", "cricket", "count_up"], index: 0, current: "x01" } };
    render(<MedleyBoard state={s} />);
    expect(screen.getByText(/Game 1 \/ 3/i)).toBeInTheDocument();
    expect(screen.getByText(/X01/i)).toBeInTheDocument();
    expect(screen.getByText("421")).toBeInTheDocument();   // X01Board rendered the score
  });

  it("delegates to the Count-Up sub-board when current is count_up", () => {
    const s = baseState();
    s.mode_view = { total: { p1: 90, p2: 60 }, rounds: 8, current_round: 2, medley: { sequence: ["count_up", "x01"], index: 0, current: "count_up" } };
    render(<MedleyBoard state={s} />);
    expect(screen.getByText(/Game 1 \/ 2/i)).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();    // CountUpBoard total
  });
});
