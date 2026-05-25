import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useStore } from "../store";
import { LiveGame } from "./LiveGame";

const baseState: any = {
  mode: "x01",
  status: "in_progress",
  players: [{ id: "p1", name: "Ann" }],
  active_index: 0,
  visit: [],
  legs: {},
  sets: {},
  winner: null,
  options: {},
  mode_view: { scores: { p1: 301 }, checkout: null },
  stats: {},
};

beforeEach(() => {
  useStore.setState({ lastHit: null, banners: [] });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LiveGame", () => {
  it("passes play tilt to Dartboard so the 3D wrapper appears", () => {
    const { container } = render(<LiveGame state={baseState} />);
    expect(container.querySelector(".dartboard-3d.tilt-play")).not.toBeNull();
  });

  it("renders a dart-landing marker when lastHit is set", () => {
    useStore.setState({ lastHit: { bed: "T20", score: 60, at: Date.now() } });
    const { container } = render(<LiveGame state={baseState} />);
    expect(container.querySelector("[data-dart-marker]")).not.toBeNull();
  });

  describe("hero tilt on win", () => {
    it("board gets tilt-hero class when a leg_won banner is added", () => {
      const { container } = render(<LiveGame state={baseState} />);
      // Initially play tilt
      expect(container.querySelector(".dartboard-3d.tilt-play")).not.toBeNull();
      // Add a leg_won banner
      act(() => {
        useStore.setState({ banners: [{ kind: "leg_won", text: "Leg to Ann", at: Date.now() }] });
      });
      expect(container.querySelector(".dartboard-3d.tilt-hero")).not.toBeNull();
    });

    it("board gets tilt-hero class when a game_won banner is added", () => {
      const { container } = render(<LiveGame state={baseState} />);
      act(() => {
        useStore.setState({ banners: [{ kind: "game_won", text: "Ann wins", at: Date.now() }] });
      });
      expect(container.querySelector(".dartboard-3d.tilt-hero")).not.toBeNull();
    });

    it("hero tilt reverts to play tilt after ~2.5s", () => {
      const { container } = render(<LiveGame state={baseState} />);
      act(() => {
        useStore.setState({ banners: [{ kind: "leg_won", text: "Leg to Ann", at: Date.now() }] });
      });
      expect(container.querySelector(".dartboard-3d.tilt-hero")).not.toBeNull();
      act(() => { vi.advanceTimersByTime(2600); });
      expect(container.querySelector(".dartboard-3d.tilt-hero")).toBeNull();
      expect(container.querySelector(".dartboard-3d.tilt-play")).not.toBeNull();
    });

    it("still swings to hero on a win after the banner list is capped (length stays constant)", () => {
      const t0 = Date.now();
      // The store caps banners at 5; fill it with non-win banners first.
      const filler = Array.from({ length: 5 }, (_, i) => ({ kind: "info", text: `b${i}`, at: t0 + i }));
      const { container } = render(<LiveGame state={baseState} />);
      act(() => { useStore.setState({ banners: filler }); });
      expect(container.querySelector(".dartboard-3d.tilt-hero")).toBeNull();
      // A new win arrives: the cap slides (oldest dropped) so the array length stays 5,
      // but the newest banner is a win with a newer timestamp.
      act(() => {
        useStore.setState({
          banners: [...filler.slice(1), { kind: "leg_won", text: "Leg to Ann", at: t0 + 100 }],
        });
      });
      expect(container.querySelector(".dartboard-3d.tilt-hero")).not.toBeNull();
    });
  });
});
