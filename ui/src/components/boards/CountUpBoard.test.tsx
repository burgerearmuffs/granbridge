import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CountUpBoard } from "./CountUpBoard";
import type { GameState } from "../../types";

function state(): GameState {
  return {
    mode: "count_up", status: "in_progress",
    players: [{ id: "p1", name: "Ann" }, { id: "p2", name: "Bo" }],
    active_index: 0, visit: [], legs: {}, sets: {}, winner: null,
    options: {}, mode_view: { total: { p1: 140, p2: 60 }, rounds: 8, current_round: 3, hits: {} }, stats: {},
  };
}

describe("CountUpBoard", () => {
  it("shows each player's total and the round header", () => {
    render(<CountUpBoard state={state()} />);
    expect(screen.getByText("140")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText(/Round 3 \/ 8/i)).toBeInTheDocument();
  });

  it("marks the current leader", () => {
    render(<CountUpBoard state={state()} />);
    expect(screen.getByLabelText("leader")).toBeInTheDocument(); // p1 (140) leads
  });
});
