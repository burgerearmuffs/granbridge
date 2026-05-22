import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Banners } from "./Banners";

describe("Banners", () => {
  it("renders nothing when banners is empty", () => {
    const { container } = render(<Banners banners={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the latest banner text", () => {
    const banners = [
      { kind: "bust", text: "BUST — Ann", at: 1000 },
      { kind: "leg_won", text: "Leg to Bo", at: 2000 },
    ];
    render(<Banners banners={banners} />);
    expect(screen.getByText("Leg to Bo")).toBeInTheDocument();
  });

  it("does not render older banners, only the latest", () => {
    const banners = [
      { kind: "bust", text: "BUST — Ann", at: 1000 },
      { kind: "leg_won", text: "Leg to Bo", at: 2000 },
    ];
    render(<Banners banners={banners} />);
    expect(screen.queryByText("BUST — Ann")).not.toBeInTheDocument();
  });
});
