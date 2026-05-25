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
});
