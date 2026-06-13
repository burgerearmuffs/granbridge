import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

// useGranbridgeSocket opens a real WS in jsdom; stub it so App renders headless.
vi.mock("./useGranbridgeSocket", () => ({ useGranbridgeSocket: () => ({ send: vi.fn() }) }));

beforeEach(() => localStorage.clear());

describe("App with stats submission mounted", () => {
  it("renders the nav and does not crash with the stats hook + startup flush", () => {
    render(<App />);
    expect(screen.getByText("GRANBRIDGE")).toBeInTheDocument();
  });

  it("has a Leaderboard nav tab", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();
  });

  it("shows onboarding on first run and never again after finishing", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const first = render(<App />);
    expect(screen.getByRole("dialog", { name: /welcome to granbridge/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /skip setup/i }));
    expect(screen.queryByRole("dialog", { name: /welcome to granbridge/i })).not.toBeInTheDocument();
    first.unmount();

    render(<App />);
    expect(screen.queryByRole("dialog", { name: /welcome to granbridge/i })).not.toBeInTheDocument();
  });

  it("has a Settings nav tab that opens the Settings view", async () => {
    const { fireEvent, waitFor } = await import("@testing-library/react");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /^settings$/i })).toBeInTheDocument(),
    );
  });
});
