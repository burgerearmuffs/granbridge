import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OpponentCard } from "./OpponentCard";

describe("OpponentCard", () => {
  it("renders the opponent name, avatar, and stats", () => {
    render(
      <OpponentCard
        profile={{ id: "id2", name: "Bob", avatar: { color: "#3b82f6" }, writeToken: "tok" }}
        summary={{ threeDartAvg: 48.6, wins: 4, gamesPlayed: 9 }}
      />,
    );
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /bob avatar/i })).toBeInTheDocument();
    expect(screen.getByText("48.6")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("renders the head-to-head line when games > 0", () => {
    render(
      <OpponentCard
        profile={{ id: "id2", name: "Bob", avatar: { color: "#3b82f6" }, writeToken: "tok" }}
        summary={{ threeDartAvg: 48.6, wins: 4, gamesPlayed: 9 }}
        headToHead={{ a: "me", b: "id2", games: 6, a_wins: 4, b_wins: 2, last_played: null, pending: 0 }}
      />,
    );
    expect(screen.getByText(/vs you:\s*4.?2/i)).toBeInTheDocument();
  });

  it("omits the head-to-head line when there are no games", () => {
    render(
      <OpponentCard
        profile={{ id: "id2", name: "Bob", avatar: { color: "#3b82f6" }, writeToken: "tok" }}
        summary={{ threeDartAvg: 48.6, wins: 4, gamesPlayed: 9 }}
        headToHead={{ a: "me", b: "id2", games: 0, a_wins: 0, b_wins: 0, last_played: null, pending: 0 }}
      />,
    );
    expect(screen.queryByText(/vs you:/i)).not.toBeInTheDocument();
  });
});
