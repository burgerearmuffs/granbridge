import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MpGameLayout } from "./MpGameLayout";

describe("MpGameLayout", () => {
  function renderLayout() {
    return render(
      <MpGameLayout
        board={<div data-testid="board-content">Board</div>}
        selfVideo={<div data-testid="self-video">Self</div>}
        oppVideo={<div data-testid="opp-video">Opp</div>}
        oppCard={<div data-testid="opp-card">Card</div>}
        controls={<div data-testid="controls">Controls</div>}
      />,
    );
  }

  it("root element carries data-mp-layout attribute", () => {
    const { container } = renderLayout();
    expect(container.querySelector("[data-mp-layout]")).not.toBeNull();
  });

  it("renders all five prop regions", () => {
    renderLayout();
    expect(screen.getByTestId("board-content")).toBeInTheDocument();
    expect(screen.getByTestId("self-video")).toBeInTheDocument();
    expect(screen.getByTestId("opp-video")).toBeInTheDocument();
    expect(screen.getByTestId("opp-card")).toBeInTheDocument();
    expect(screen.getByTestId("controls")).toBeInTheDocument();
  });

  it("board region is present in the DOM", () => {
    const { container } = renderLayout();
    expect(container.querySelector("[data-board-zone]")).not.toBeNull();
  });

  it("opponent video region is present in the DOM", () => {
    const { container } = renderLayout();
    expect(container.querySelector("[data-opp-video-zone]")).not.toBeNull();
  });

  it("renders without error when optional oppCard is null", () => {
    const { container } = render(
      <MpGameLayout
        board={<div>Board</div>}
        selfVideo={<div>Self</div>}
        oppVideo={<div>Opp</div>}
        oppCard={null}
        controls={<div>Controls</div>}
      />,
    );
    expect(container.querySelector("[data-mp-layout]")).not.toBeNull();
  });
});
