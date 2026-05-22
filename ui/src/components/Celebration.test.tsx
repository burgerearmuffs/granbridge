import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Celebration } from "./Celebration";

describe("Celebration", () => {
  it("renders without crashing", () => {
    const { container } = render(<Celebration trigger={0} />);
    expect(container).toBeTruthy();
  });

  it("renders a canvas element", () => {
    const { container } = render(<Celebration trigger={0} />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
  });

  it("canvas has pointer-events:none style", () => {
    const { container } = render(<Celebration trigger={0} />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.style.pointerEvents).toBe("none");
  });

  it("canvas is aria-hidden", () => {
    const { container } = render(<Celebration trigger={0} />);
    const canvas = container.querySelector("canvas");
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
  });

  it("re-renders with new trigger without crashing", () => {
    const { rerender, container } = render(<Celebration trigger={0} />);
    rerender(<Celebration trigger={1} />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
  });
});
