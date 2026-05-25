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
});
