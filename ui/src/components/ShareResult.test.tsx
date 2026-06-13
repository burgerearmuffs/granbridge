/**
 * ShareResult + CommentaryTicker + store commentary handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ShareResult } from "./ShareResult";
import { CommentaryTicker } from "./CommentaryTicker";
import { useStore } from "../store";
import { buildResultText } from "../share/resultCard";
import type { GameState } from "../types";

const FINISHED: GameState = {
  mode: "x01", status: "finished",
  players: [{ id: "p1", name: "Ann" }, { id: "p2", name: "Bo" }],
  active_index: 0, visit: [], legs: { p1: 2, p2: 0 }, sets: {},
  winner: "p1", options: { start_score: 501 }, mode_view: {},
  stats: {
    p1: { darts: 45, total_scored: 813, three_dart_avg: 54.2 },
    p2: { darts: 42, total_scored: 698, three_dart_avg: 49.9 },
  },
};

beforeEach(() => useStore.getState().reset());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ShareResult", () => {
  it("renders nothing while the game is in progress", () => {
    const { container } = render(<ShareResult state={{ ...FINISHED, status: "in_progress" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("copies the result text to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<ShareResult state={FINISHED} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy result/i }));
    });
    expect(writeText).toHaveBeenCalledWith(buildResultText(FINISHED));
    expect(screen.getByRole("button", { name: /copy result/i })).toHaveTextContent(/copied/i);
  });

  it("shows an inline error when the image can't render (jsdom)", () => {
    render(<ShareResult state={FINISHED} />);
    fireEvent.click(screen.getByRole("button", { name: /save result image/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't render/i);
  });
});

describe("CommentaryTicker", () => {
  it("renders nothing without a commentary line", () => {
    const { container } = render(<CommentaryTicker />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a line from the store and hides it after the display window", () => {
    vi.useFakeTimers();
    render(<CommentaryTicker />);
    act(() => {
      useStore.getState().applyEvent({ type: "commentary", text: "One hundred and eighty!" });
    });
    expect(screen.getByRole("status")).toHaveTextContent("One hundred and eighty!");
    act(() => { vi.advanceTimersByTime(6001); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("store commentary handling", () => {
  it("stores the latest commentary line and clears it on reset", () => {
    useStore.getState().applyEvent({ type: "commentary", text: "Ton eighty pace." });
    expect(useStore.getState().commentary?.text).toBe("Ton eighty pace.");
    useStore.getState().reset();
    expect(useStore.getState().commentary).toBeNull();
  });
});
