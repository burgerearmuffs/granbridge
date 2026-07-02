import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DisconnectBanner } from "./DisconnectBanner";

describe("DisconnectBanner", () => {
  it("renders nothing while connected", () => {
    render(<DisconnectBanner connection="connected" playing={true} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing when no game is in progress", () => {
    render(<DisconnectBanner connection="disconnected" playing={false} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a reconnecting message for board-side states", () => {
    for (const state of ["reconnecting", "scanning", "connecting"]) {
      const { unmount } = render(<DisconnectBanner connection={state} playing={true} />);
      expect(screen.getByRole("alert").textContent).toMatch(/board.*reconnecting/i);
      unmount();
    }
  });

  it("shows a bridge message when fully disconnected", () => {
    render(<DisconnectBanner connection="disconnected" playing={true} />);
    expect(screen.getByRole("alert").textContent).toMatch(/connection lost/i);
    expect(screen.getByRole("alert").textContent).toMatch(/darts.*safe|game.*saved|resumes/i);
  });
});
