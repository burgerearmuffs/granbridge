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
