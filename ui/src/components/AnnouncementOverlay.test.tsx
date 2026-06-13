/**
 * AnnouncementOverlay + the store's big-hit detection (single darts and 180s).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AnnouncementOverlay, ANNOUNCE_LABELS } from "./AnnouncementOverlay";
import { useStore } from "../store";
import { announceForHit } from "../video/decide";
import type { Event } from "../types";

function hit(bed: string, score: number): Event {
  return { type: "dart_hit", bed, ring: "T", segment: 20, multiplier: 3, score };
}

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("announceForHit", () => {
  it("maps the announced beds and nothing else", () => {
    expect(announceForHit("T20")).toBe("treble-twenty");
    expect(announceForHit("T19")).toBe("treble-nineteen");
    expect(announceForHit("T18")).toBe("treble-eighteen");
    expect(announceForHit("DBULL")).toBe("bullseye");
    expect(announceForHit("BULL")).toBeNull();
    expect(announceForHit("T17")).toBeNull();
    expect(announceForHit("S20")).toBeNull();
  });
});

describe("store big-hit detection", () => {
  it("a T20 sets a treble-twenty announcement", () => {
    useStore.getState().applyEvent(hit("T20", 60));
    expect(useStore.getState().announcement?.key).toBe("treble-twenty");
  });

  it("three darts summing 180 announce one-eighty (outranking the third treble)", () => {
    const apply = useStore.getState().applyEvent;
    apply(hit("T20", 60));
    apply(hit("T20", 60));
    apply(hit("T20", 60));
    expect(useStore.getState().announcement?.key).toBe("one-eighty");
    expect(useStore.getState().visitScores).toEqual([]);
  });

  it("a 177 visit keeps the third dart's own announcement", () => {
    const apply = useStore.getState().applyEvent;
    apply(hit("T20", 60));
    apply(hit("T19", 57));
    apply(hit("T20", 60));
    expect(useStore.getState().announcement?.key).toBe("treble-twenty");
  });

  it("an empty-visit game_state resets the 180 tracker (early next player)", () => {
    const apply = useStore.getState().applyEvent;
    apply(hit("T20", 60));
    apply({
      type: "game_state",
      state: {
        mode: "x01", status: "in_progress", players: [], active_index: 0,
        visit: [], legs: {}, sets: {}, winner: null, options: {}, mode_view: {}, stats: {},
      },
    } as Event);
    expect(useStore.getState().visitScores).toEqual([]);
    apply(hit("T20", 60));
    apply(hit("T20", 60));
    // Only 2 darts since the reset — no 180 yet.
    expect(useStore.getState().announcement?.key).toBe("treble-twenty");
  });
});

describe("AnnouncementOverlay", () => {
  it("renders nothing without an announcement", () => {
    const { container } = render(<AnnouncementOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it("flashes on a T20 and falls back to procedural text when the clip 404s", () => {
    vi.useFakeTimers();
    render(<AnnouncementOverlay />);
    act(() => { useStore.getState().applyEvent(hit("T20", 60)); });
    const overlay = screen.getByTestId("announcement-overlay");
    expect(overlay).toHaveAttribute("aria-label", ANNOUNCE_LABELS["treble-twenty"]);
    // Clip missing (jsdom never loads it) → simulate the 404 error path
    fireEvent.error(screen.getByTestId("announcement-video"));
    expect(screen.getByText("TREBLE TWENTY!")).toBeInTheDocument();
    // Procedural flash auto-hides
    act(() => { vi.advanceTimersByTime(1801); });
    expect(screen.queryByTestId("announcement-overlay")).not.toBeInTheDocument();
  });

  it("reduced motion shows static text briefly, never a video", () => {
    localStorage.setItem("granbridge.video", JSON.stringify({ enabled: true, reducedMotion: true }));
    vi.useFakeTimers();
    render(<AnnouncementOverlay />);
    act(() => { useStore.getState().applyEvent(hit("DBULL", 50)); });
    expect(screen.queryByTestId("announcement-video")).not.toBeInTheDocument();
    expect(screen.getByText("BULLSEYE!")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1201); });
    expect(screen.queryByTestId("announcement-overlay")).not.toBeInTheDocument();
  });

  it("renders nothing when celebration videos are disabled", () => {
    localStorage.setItem("granbridge.video", JSON.stringify({ enabled: false }));
    render(<AnnouncementOverlay />);
    act(() => { useStore.getState().applyEvent(hit("T20", 60)); });
    expect(screen.queryByTestId("announcement-overlay")).not.toBeInTheDocument();
  });

  it("re-fires for a new announcement of the same key", () => {
    vi.useFakeTimers();
    render(<AnnouncementOverlay />);
    act(() => { useStore.getState().applyEvent(hit("T20", 60)); });
    act(() => { vi.advanceTimersByTime(5001); });
    expect(screen.queryByTestId("announcement-overlay")).not.toBeInTheDocument();
    act(() => {
      vi.setSystemTime(Date.now() + 10);
      useStore.getState().applyEvent(hit("T20", 60));
    });
    expect(screen.getByTestId("announcement-overlay")).toBeInTheDocument();
  });
});
