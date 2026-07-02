import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { EntranceOverlay } from "./EntranceOverlay";
import { useStore } from "../store";

class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  volume = 1;
  played = 0;
  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  play() {
    this.played += 1;
    return Promise.resolve();
  }
}

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
  FakeAudio.instances = [];
  vi.stubGlobal("Audio", FakeAudio);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function trigger(theme: "gold" | "teal" | "inferno" = "gold", name = "Willa") {
  act(() => {
    useStore.getState().triggerEntrance(theme, name);
  });
}

describe("EntranceOverlay", () => {
  it("renders nothing without a cue", () => {
    render(<EntranceOverlay />);
    expect(screen.queryByTestId("entrance-overlay")).toBeNull();
  });

  it("shows the player name and theme video on a cue, and plays the fanfare", () => {
    render(<EntranceOverlay />);
    trigger("gold", "Willa");

    expect(screen.getByTestId("entrance-overlay")).toBeInTheDocument();
    expect(screen.getByText("Willa")).toBeInTheDocument();
    const video = screen.getByTestId("entrance-video") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe("/videos/entrance-gold.mp4");
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toBe("/sounds/entrance-gold.mp3");
    expect(FakeAudio.instances[0].played).toBe(1);
  });

  it("falls back to the name card when the video errors", () => {
    render(<EntranceOverlay />);
    trigger("teal");

    fireEvent.error(screen.getByTestId("entrance-video"));
    expect(screen.queryByTestId("entrance-video")).toBeNull();
    expect(screen.getByTestId("entrance-overlay")).toBeInTheDocument();
  });

  it("dismisses on click (skip)", () => {
    render(<EntranceOverlay />);
    trigger();

    fireEvent.click(screen.getByTestId("entrance-overlay"));
    expect(screen.queryByTestId("entrance-overlay")).toBeNull();
  });

  it("auto-hides at the cap", () => {
    vi.useFakeTimers();
    render(<EntranceOverlay />);
    trigger();

    act(() => {
      vi.advanceTimersByTime(4600);
    });
    expect(screen.queryByTestId("entrance-overlay")).toBeNull();
  });

  it("respects video disabled setting", () => {
    localStorage.setItem("granbridge.video", JSON.stringify({ enabled: false }));
    render(<EntranceOverlay />);
    trigger();

    expect(screen.queryByTestId("entrance-overlay")).toBeNull();
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("reduced motion: name card only, no video, no fanfare", () => {
    localStorage.setItem("granbridge.video", JSON.stringify({ reducedMotion: true }));
    render(<EntranceOverlay />);
    trigger("inferno", "Ann");

    expect(screen.getByText("Ann")).toBeInTheDocument();
    expect(screen.queryByTestId("entrance-video")).toBeNull();
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("does not replay the same cue on re-render", () => {
    const { rerender } = render(<EntranceOverlay />);
    trigger();
    fireEvent.click(screen.getByTestId("entrance-overlay"));

    rerender(<EntranceOverlay />);
    expect(screen.queryByTestId("entrance-overlay")).toBeNull();
    expect(FakeAudio.instances).toHaveLength(1);
  });
});
