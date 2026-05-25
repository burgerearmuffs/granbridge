import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
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
  useStore.setState({ lastHit: null });
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
});
