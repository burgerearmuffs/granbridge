// ui/src/views/Leaderboard.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Leaderboard } from "./Leaderboard";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mockBoard(byMetric: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    const metric = url.includes("metric=wins") ? "wins" : "avg";
    return Promise.resolve({ ok: true, json: () => Promise.resolve(byMetric[metric]) });
  }) as unknown as typeof globalThis.fetch);
}

describe("Leaderboard", () => {
  it("renders ranked players for the default avg metric", async () => {
    mockBoard({ avg: { metric: "avg", players: [
      { id: "p1", display_name: "Ann", avatar_color: "#f00", games: 5, wins: 3, three_dart_avg: 62.5 },
      { id: "p2", display_name: "Bob", avatar_color: "#0f0", games: 4, wins: 1, three_dart_avg: 48 },
    ] } });
    render(<Leaderboard />);
    await waitFor(() => expect(screen.getByText("Ann")).toBeInTheDocument());
    expect(screen.getByText("62.5")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("switches metric and refetches", async () => {
    mockBoard({
      avg: { metric: "avg", players: [{ id: "p1", display_name: "Ann", avatar_color: "#f00", games: 5, wins: 3, three_dart_avg: 62.5 }] },
      wins: { metric: "wins", players: [{ id: "p2", display_name: "Bob", avatar_color: "#0f0", games: 9, wins: 8, three_dart_avg: 40 }] },
    });
    render(<Leaderboard />);
    await waitFor(() => expect(screen.getByText("Ann")).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /wins/i })); });
    await waitFor(() => expect(screen.getByText("Bob")).toBeInTheDocument());
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("shows an empty state when no verified matches", async () => {
    mockBoard({ avg: { metric: "avg", players: [] } });
    render(<Leaderboard />);
    await waitFor(() => expect(screen.getByText(/no verified matches yet/i)).toBeInTheDocument());
  });

  it("shows an error state when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    render(<Leaderboard />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("ignores a slow avg response that resolves after switching to wins", async () => {
    let resolveAvg!: (v: unknown) => void;
    const gate = new Promise<unknown>((r) => { resolveAvg = r; });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("metric=wins")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ metric: "wins", players: [
          { id: "p2", display_name: "Bob", avatar_color: "#0f0", games: 9, wins: 8, three_dart_avg: 40 }] }) });
      }
      return gate.then(() => ({ ok: true, json: () => Promise.resolve({ metric: "avg", players: [
        { id: "p1", display_name: "Ann", avatar_color: "#f00", games: 5, wins: 3, three_dart_avg: 62.5 }] }) }));
    }) as unknown as typeof globalThis.fetch);
    render(<Leaderboard />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /wins/i })); });
    await waitFor(() => expect(screen.getByText("Bob")).toBeInTheDocument());
    await act(async () => { resolveAvg(null); await Promise.resolve(); });
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Ann")).not.toBeInTheDocument();
  });
});
