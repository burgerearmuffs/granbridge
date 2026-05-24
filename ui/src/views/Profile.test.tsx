import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Profile } from "./Profile";

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// URL-aware fetch: /stats/player/* (server) vs /api/history/stats (local fallback).
function mockFetch(opts: { player?: unknown; serverOk?: boolean; localRows?: unknown } = {}) {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/stats/player/")) {
      if (opts.serverOk === false) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(opts.player ?? {}) });
    }
    if (url.includes("/api/history/stats")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(opts.localRows ?? []) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  }) as unknown as typeof globalThis.fetch);
}

describe("Profile view", () => {
  it("renders the display-name input and the avatar preview", async () => {
    mockFetch();
    await act(async () => { render(<Profile />); });
    expect(screen.getByRole("textbox", { name: /display name/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /avatar/i })).toBeInTheDocument();
  });

  it("renders the palette color swatches", async () => {
    mockFetch();
    await act(async () => { render(<Profile />); });
    expect(screen.getAllByRole("button", { name: /^color #/i })).toHaveLength(8);
  });

  it("shows my server career stats (across devices) when the broker responds", async () => {
    localStorage.setItem("granbridge.player", JSON.stringify({ id: "id1", name: "Ada", avatar: { color: "#f59e0b" }, writeToken: "t" }));
    mockFetch({ player: { id: "id1", display_name: "Ada", avatar_color: "#f59e0b", games_played: 5, wins: 2, verified_games: 3, darts: 90, total_scored: 1500, three_dart_avg: 55.4, heatmap: {} } });
    render(<Profile />);
    await waitFor(() => expect(screen.getByText("55.4")).toBeInTheDocument());
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText(/across devices/i)).toBeInTheDocument();
  });

  it("falls back to local stats when the broker is unreachable", async () => {
    localStorage.setItem("granbridge.player", JSON.stringify({ id: "id1", name: "Ada", avatar: { color: "#f59e0b" }, writeToken: "t" }));
    mockFetch({ serverOk: false, localRows: [{ player: "Ada", three_dart_avg: 40, wins: 1, games_played: 3 }] });
    render(<Profile />);
    await waitFor(() => expect(screen.getByText("40.0")).toBeInTheDocument());
    expect(screen.getByText(/this device/i)).toBeInTheDocument();
  });

  it("updates the display name on input", async () => {
    mockFetch();
    await act(async () => { render(<Profile />); });
    const input = screen.getByRole("textbox", { name: /display name/i });
    await act(async () => { fireEvent.change(input, { target: { value: "Zoe" } }); });
    expect((input as HTMLInputElement).value).toBe("Zoe");
    expect(JSON.parse(localStorage.getItem("granbridge.player")!).name).toBe("Zoe");
  });
});
