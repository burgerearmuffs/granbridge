import { render, screen } from "@testing-library/react";
import { X01Board } from "./X01Board";
const state: any = { players:[{id:"p1",name:"Ann"},{id:"p2",name:"Bo"}], active_index:0,
  mode_view:{ scores:{p1:441,p2:501}, checkout:["T20","D20"] } };
it("shows scores and checkout and active highlight", () => {
  render(<X01Board state={state} />);
  expect(screen.getByText("441")).toBeInTheDocument();
  expect(screen.getByText("Ann")).toBeInTheDocument();
  expect(screen.getByText(/T20/)).toBeInTheDocument();
});
it("active player card carries data-active attribute", () => {
  const { container } = render(<X01Board state={state} />);
  const activeCard = container.querySelector("[data-active='true']");
  expect(activeCard).not.toBeNull();
});
it("inactive player card does not carry data-active", () => {
  const { container } = render(<X01Board state={state} />);
  const allCards = container.querySelectorAll("[data-active]");
  // Only 1 card should have data-active=true (the active player)
  const activeCards = Array.from(allCards).filter(el => el.getAttribute("data-active") === "true");
  expect(activeCards.length).toBe(1);
});
it("score element carries data-score attribute", () => {
  const { container } = render(<X01Board state={state} />);
  const scoreEl = container.querySelector("[data-score]");
  expect(scoreEl).not.toBeNull();
});
