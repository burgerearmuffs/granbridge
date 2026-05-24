import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "./UpdateBanner";
import type { UpdaterState } from "../useUpdater";

function makeState(overrides: Partial<UpdaterState> = {}): UpdaterState {
  return {
    phase: "available",
    version: "0.1.2",
    notes: null,
    progress: 0,
    error: null,
    startUpdate: vi.fn(),
    dismiss: vi.fn(),
    ...overrides,
  };
}

describe("UpdateBanner", () => {
  it("shows the new version and triggers startUpdate", () => {
    const startUpdate = vi.fn();
    render(<UpdateBanner state={makeState({ startUpdate })} />);
    expect(screen.getByText(/0\.1\.2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /update & restart/i }));
    expect(startUpdate).toHaveBeenCalled();
  });

  it("renders nothing when idle", () => {
    const { container } = render(<UpdateBanner state={makeState({ phase: "idle", version: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when dismissed", () => {
    const { container } = render(<UpdateBanner state={makeState({ phase: "dismissed" })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows download progress", () => {
    render(<UpdateBanner state={makeState({ phase: "downloading", progress: 0.42 })} />);
    expect(screen.getByText(/42%/)).toBeInTheDocument();
  });

  it("dismiss button calls dismiss", () => {
    const dismiss = vi.fn();
    render(<UpdateBanner state={makeState({ dismiss })} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(dismiss).toHaveBeenCalled();
  });
});
