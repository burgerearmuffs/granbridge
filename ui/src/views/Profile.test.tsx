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
    expect(screen.getByText(/\(this device\)/i)).toBeInTheDocument();
  });

  it("updates the display name on input", async () => {
    mockFetch();
    await act(async () => { render(<Profile />); });
    const input = screen.getByRole("textbox", { name: /display name/i });
    await act(async () => { fireEvent.change(input, { target: { value: "Zoe" } }); });
    expect((input as HTMLInputElement).value).toBe("Zoe");
    expect(JSON.parse(localStorage.getItem("granbridge.player")!).name).toBe("Zoe");
  });

  it("exports a recovery key to the clipboard", async () => {
    localStorage.setItem("granbridge.player", JSON.stringify({ id: "id1", name: "Ada", avatar: { color: "#f59e0b" }, writeToken: "tok-1" }));
    mockFetch({ player: { three_dart_avg: 0, wins: 0, games_played: 0 } });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await act(async () => { render(<Profile />); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /export recovery key/i })); });
    const expected = btoa("granbridge:id1:tok-1");
    expect(writeText).toHaveBeenCalledWith(expected);
  });

  it("restores identity from a pasted recovery key", async () => {
    localStorage.setItem("granbridge.player", JSON.stringify({ id: "old", name: "Ada", avatar: { color: "#f59e0b" }, writeToken: "oldtok" }));
    mockFetch({ player: { three_dart_avg: 0, wins: 0, games_played: 0 } });
    await act(async () => { render(<Profile />); });
    const key = btoa("granbridge:restored-id:restored-tok");
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: /recovery key/i }), { target: { value: key } });
      fireEvent.click(screen.getByRole("button", { name: /^restore$/i }));
    });
    expect(JSON.parse(localStorage.getItem("granbridge.player")!).id).toBe("restored-id");
    expect(JSON.parse(localStorage.getItem("granbridge.player")!).writeToken).toBe("restored-tok");
  });

  it("toggles the upload preference and persists it", async () => {
    mockFetch({ player: { three_dart_avg: 0, wins: 0, games_played: 0 } });
    await act(async () => { render(<Profile />); });
    const toggle = screen.getByRole("checkbox", { name: /upload my stats/i });
    expect((toggle as HTMLInputElement).checked).toBe(true); // default on
    await act(async () => { fireEvent.click(toggle); });
    expect(localStorage.getItem("granbridge.uploadStats")).toBe("false");
    expect((toggle as HTMLInputElement).checked).toBe(false);
  });

  it("shows an error for a malformed recovery key", async () => {
    mockFetch({ player: { three_dart_avg: 0, wins: 0, games_played: 0 } });
    await act(async () => { render(<Profile />); });
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: /recovery key/i }), { target: { value: "not-a-valid-key" } });
      fireEvent.click(screen.getByRole("button", { name: /^restore$/i }));
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
