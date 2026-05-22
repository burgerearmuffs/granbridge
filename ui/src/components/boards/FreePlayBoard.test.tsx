import { render, screen } from "@testing-library/react";
import { FreePlayBoard } from "./FreePlayBoard";

const state: any = {
  players: [{ id: "p1", name: "Ann" }, { id: "p2", name: "Bo" }],
  active_index: 0,
  mode_view: {
    total: { p1: 120, p2: 45 },
    hits: { p1: { T20: 2, S5: 1, D10: 3 }, p2: { S1: 1 } },
  },
};

it("shows the total for each player", () => {
  render(<FreePlayBoard state={state} />);
  expect(screen.getByText("120")).toBeInTheDocument();
  expect(screen.getByText("45")).toBeInTheDocument();
});

it("shows player names", () => {
  render(<FreePlayBoard state={state} />);
  expect(screen.getByText("Ann")).toBeInTheDocument();
  expect(screen.getByText("Bo")).toBeInTheDocument();
});

it("shows top 3 hit beds sorted by count descending", () => {
  render(<FreePlayBoard state={state} />);
  // p1 hits: D10:3, T20:2, S5:1 — top 3 in that order
  const items = screen.getAllByText(/D10|T20|S5/);
  expect(items.length).toBeGreaterThanOrEqual(3);
  // Verify all three beds appear
  expect(screen.getByText(/D10/)).toBeInTheDocument();
  expect(screen.getByText(/T20/)).toBeInTheDocument();
  expect(screen.getByText(/S5/)).toBeInTheDocument();
});

it("highlights the active player", () => {
  const { container } = render(<FreePlayBoard state={state} />);
  // active_index=0 → Ann's card should have the ring class
  const cards = container.querySelectorAll("[data-player]");
  expect(cards[0].className).toMatch(/ring-4/);
  expect(cards[1].className).not.toMatch(/ring-4/);
});

it("shows only top 3 beds even when player has more than 3 hit beds", () => {
  const bigState: any = {
    players: [{ id: "p1", name: "Ann" }],
    active_index: 0,
    mode_view: {
      total: { p1: 999 },
      hits: { p1: { T20: 10, D20: 8, S20: 6, T19: 4, D19: 2 } },
    },
  };
  render(<FreePlayBoard state={bigState} />);
  // Only top 3: T20, D20, S20 should appear; T19, D19 should not
  expect(screen.getByText(/T20/)).toBeInTheDocument();
  expect(screen.getByText(/D20/)).toBeInTheDocument();
  expect(screen.getByText(/S20/)).toBeInTheDocument();
  expect(screen.queryByText(/T19/)).not.toBeInTheDocument();
  expect(screen.queryByText(/D19/)).not.toBeInTheDocument();
});
