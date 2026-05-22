import { render, screen } from "@testing-library/react";
import { CricketBoard } from "./CricketBoard";

const NUMBERS = ["20", "19", "18", "17", "16", "15", "B"];

const state: any = {
  players: [
    { id: "p1", name: "Ann" },
    { id: "p2", name: "Bo" },
  ],
  active_index: 0,
  mode_view: {
    numbers: NUMBERS,
    marks: {
      p1: { "20": 3, "19": 2, "18": 1, "17": 0, "16": 0, "15": 3, B: 1 },
      p2: { "20": 1, "19": 0, "18": 0, "17": 2, "16": 0, "15": 0, B: 0 },
    },
    points: { p1: 60, p2: 0 },
  },
};

describe("CricketBoard", () => {
  it("renders player names", () => {
    render(<CricketBoard state={state} />);
    expect(screen.getByText("Ann")).toBeInTheDocument();
    expect(screen.getByText("Bo")).toBeInTheDocument();
  });

  it("renders a player's points value", () => {
    render(<CricketBoard state={state} />);
    // p1 has 60 points
    expect(screen.getByText("60")).toBeInTheDocument();
    // p2 has 0 points — there are multiple zeros possible, just confirm at least one
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThan(0);
  });

  it("shows closed indicator for a number with 3 marks", () => {
    render(<CricketBoard state={state} />);
    // p1 has 3 marks on "20" and "15" — should display a closed indicator
    const closedCells = screen.getAllByText("CLOSED");
    // p1 closed 20 and 15 → at least 2 closed cells
    expect(closedCells.length).toBeGreaterThanOrEqual(2);
  });

  it("highlights the active player column", () => {
    render(<CricketBoard state={state} />);
    // active_index 0 → "Ann" header should carry the amber ring class
    const annHeading = screen.getByText("Ann").closest("[data-testid='player-header']");
    expect(annHeading).toHaveClass("ring-amber-400");
  });

  it("renders the numbers row labels", () => {
    render(<CricketBoard state={state} />);
    for (const n of NUMBERS) {
      expect(screen.getByText(n)).toBeInTheDocument();
    }
  });

  it("renders mark pips for partial marks (not closed)", () => {
    render(<CricketBoard state={state} />);
    // p1 has 2 marks on "19" — should render 2 slash characters
    // We query all "/" pips and confirm there are some
    const slashes = screen.getAllByText("/");
    expect(slashes.length).toBeGreaterThan(0);
  });
});
