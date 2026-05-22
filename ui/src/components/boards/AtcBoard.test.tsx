import { render, screen } from "@testing-library/react";
import { AtcBoard } from "./AtcBoard";

const makeState = (target: Record<string, number>, active_index = 0): any => ({
  players: [
    { id: "p1", name: "Ann" },
    { id: "p2", name: "Bo" },
  ],
  active_index,
  mode_view: { target },
});

it("shows numeric target as-is (stage 1–20)", () => {
  render(<AtcBoard state={makeState({ p1: 5, p2: 1 })} />);
  expect(screen.getByText("5")).toBeInTheDocument();
  expect(screen.getByText("1")).toBeInTheDocument();
});

it("renders stage 21 as BULL", () => {
  render(<AtcBoard state={makeState({ p1: 21, p2: 3 })} />);
  expect(screen.getByText("BULL")).toBeInTheDocument();
});

it("renders stage 22 as DONE", () => {
  render(<AtcBoard state={makeState({ p1: 22, p2: 10 })} />);
  expect(screen.getByText("DONE")).toBeInTheDocument();
});

it("shows player names", () => {
  render(<AtcBoard state={makeState({ p1: 7, p2: 7 })} />);
  expect(screen.getByText("Ann")).toBeInTheDocument();
  expect(screen.getByText("Bo")).toBeInTheDocument();
});

it("highlights the active player with ring class", () => {
  const { container } = render(<AtcBoard state={makeState({ p1: 7, p2: 7 }, 0)} />);
  // active player card should have ring styling; inactive should not
  const cards = container.querySelectorAll("[data-testid='player-card']");
  expect(cards[0].className).toMatch(/ring-amber-400/);
  expect(cards[1].className).not.toMatch(/ring-amber-400/);
});
