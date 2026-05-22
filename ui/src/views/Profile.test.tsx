import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Profile } from "./Profile";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

function mockStats(rows: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(rows) }));
}

describe("Profile view", () => {
  it("renders the display-name input and the avatar preview", () => {
    mockStats([]);
    render(<Profile />);
    expect(screen.getByRole("textbox", { name: /display name/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /avatar/i })).toBeInTheDocument();
  });

  it("renders the palette color swatches", () => {
    mockStats([]);
    render(<Profile />);
    expect(screen.getAllByRole("button", { name: /^color #/i })).toHaveLength(8);
  });

  it("shows my career stats once loaded", async () => {
    localStorage.setItem("granbridge.player", JSON.stringify({ id: "id1", name: "Ada", avatar: { color: "#f59e0b" } }));
    mockStats([{ player: "Ada", three_dart_avg: 55.4, wins: 2, games_played: 5 }]);
    render(<Profile />);
    await waitFor(() => expect(screen.getByText("55.4")).toBeInTheDocument());
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("updates the display name on input", () => {
    mockStats([]);
    render(<Profile />);
    const input = screen.getByRole("textbox", { name: /display name/i });
    fireEvent.change(input, { target: { value: "Zoe" } });
    expect((input as HTMLInputElement).value).toBe("Zoe");
    expect(JSON.parse(localStorage.getItem("granbridge.player")!).name).toBe("Zoe");
  });
});
