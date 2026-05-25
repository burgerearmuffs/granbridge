import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { History } from "./History";

const STATS_PAYLOAD = [
  {
    player: "Alice",
    games_played: 5,
    wins: 3,
    darts: 120,
    total_scored: 1800,
    three_dart_avg: 45.0,
  },
  {
    player: "Bob",
    games_played: 5,
    wins: 2,
    darts: 135,
    total_scored: 1620,
    three_dart_avg: 36.0,
  },
];

const RECENT_PAYLOAD = [
  {
    id: 1,
    mode: "x01",
    players_json: JSON.stringify(["Alice", "Bob"]),
    winner: "Alice",
    started_at: "2026-05-20T18:00:00Z",
    ended_at: "2026-05-20T18:30:00Z",
  },
  {
    id: 2,
    mode: "cricket",
    players_json: ["Alice", "Bob"], // already an array
    winner: "Bob",
    started_at: "2026-05-21T19:00:00Z",
    ended_at: "2026-05-21T19:45:00Z",
  },
];

const HEATMAP_PAYLOAD: Record<string, number> = {
  T20: 42,
  S1: 5,
  BULL: 12,
};

function makeFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn((url: string) => {
    const responses: Record<string, unknown> = {
      "/api/history/stats": STATS_PAYLOAD,
      "/api/history/recent": RECENT_PAYLOAD,
      "/api/history/heatmap": HEATMAP_PAYLOAD,
      ...overrides,
    };
    // History fetches the bridge on an absolute base; strip it so the mock matches by path.
    const path = (url as string).replace(/^https?:\/\/[^/]+/, "");
    const data = responses[path];
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(data),
    });
  }) as unknown as typeof globalThis.fetch;
}

describe("History view", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("shows loading state initially", () => {
    // Fetch never resolves
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof globalThis.fetch;
    render(<History />);
    expect(screen.getByText(/loading history/i)).toBeInTheDocument();
  });

  it("renders player stats with 3-dart avg after load", async () => {
    globalThis.fetch = makeFetch();
    render(<History />);

    await waitFor(() =>
      expect(screen.getByText("Alice")).toBeInTheDocument()
    );

    // Check Alice's 3-dart avg (45.0)
    expect(screen.getByText("45.0")).toBeInTheDocument();
    // Check Bob's 3-dart avg (36.0)
    expect(screen.getByText("36.0")).toBeInTheDocument();
  });

  it("renders wins and games played for each player", async () => {
    globalThis.fetch = makeFetch();
    render(<History />);

    await waitFor(() =>
      expect(screen.getByText("Alice")).toBeInTheDocument()
    );

    // Games played = 5 for each player (two cells with "5")
    const fiveCells = screen.getAllByText("5");
    expect(fiveCells.length).toBeGreaterThanOrEqual(2);
  });

  it("renders recent game winners", async () => {
    globalThis.fetch = makeFetch();
    render(<History />);

    await waitFor(() =>
      expect(screen.getByText(/Winner: Alice/i)).toBeInTheDocument()
    );

    expect(screen.getByText(/Winner: Bob/i)).toBeInTheDocument();
  });

  it("renders game mode labels", async () => {
    globalThis.fetch = makeFetch();
    render(<History />);

    await waitFor(() =>
      expect(screen.getByText("x01")).toBeInTheDocument()
    );

    expect(screen.getByText("cricket")).toBeInTheDocument();
  });

  it("handles players_json as a plain JSON string defensively", async () => {
    globalThis.fetch = makeFetch();
    render(<History />);

    // Both game entries have players Alice and Bob
    await waitFor(() =>
      expect(screen.getAllByText(/Alice.*Bob|Bob.*Alice/).length).toBeGreaterThan(0)
    );
  });

  it("renders the Dartboard component", async () => {
    globalThis.fetch = makeFetch();
    const { container } = render(<History />);

    await waitFor(() =>
      expect(container.querySelector("svg[aria-label='dartboard']")).not.toBeNull()
    );
  });

  it("shows error message when fetch fails", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve([]) })
    ) as unknown as typeof globalThis.fetch;

    render(<History />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument()
    );
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });

  it("shows error message when fetch rejects", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("Network error"))
    ) as typeof globalThis.fetch;

    render(<History />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument()
    );
  });

  it("shows empty state message when no stats available", async () => {
    globalThis.fetch = makeFetch({
      "/api/history/stats": [],
      "/api/history/recent": [],
    });
    render(<History />);

    await waitFor(() =>
      expect(screen.getByText(/no stats recorded/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/no games recorded/i)).toBeInTheDocument();
  });

  it("requests history from the absolute bridge base, not a relative path", async () => {
    const fetchMock = makeFetch();
    globalThis.fetch = fetchMock;
    render(<History />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8080/api/history/stats");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8080/api/history/recent");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8080/api/history/heatmap");
  });
});
