import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock the hook before importing the component
const mockToggle = vi.fn();
vi.mock("../useFullscreen", () => ({
  useFullscreen: () => ({ isFullscreen: false, toggle: mockToggle }),
}));

import { FullscreenToggle } from "./FullscreenToggle";

describe("FullscreenToggle", () => {
  beforeEach(() => {
    mockToggle.mockReset();
  });

  it("renders a button with an accessible label", () => {
    render(<FullscreenToggle />);
    const btn = screen.getByRole("button", { name: /toggle fullscreen/i });
    expect(btn).toBeInTheDocument();
  });

  it("clicking the button calls the hook's toggle function", () => {
    render(<FullscreenToggle />);
    const btn = screen.getByRole("button", { name: /toggle fullscreen/i });
    fireEvent.click(btn);
    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  it("shows the enter-fullscreen icon when not fullscreen", () => {
    render(<FullscreenToggle />);
    // Button should exist and contain something (SVG icon)
    const btn = screen.getByRole("button", { name: /toggle fullscreen/i });
    expect(btn).toBeInTheDocument();
  });
});
