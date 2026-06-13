/**
 * Tournament view — setup form, bracket rendering, play-match bridge command,
 * auto-advance from a finished game, manual winner recording, persistence.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tournament } from "./Tournament";
import { useTournamentStore } from "../tournament/store";
import { useStore } from "../store";
import { bridgeLink } from "../bridgeLink";

function fillNames(names: string[]) {
  // Add inputs until we have enough
  for (let i = 2; i < names.length; i++) {
    fireEvent.click(screen.getByRole("button", { name: /add player/i }));
  }
  names.forEach((n, i) => {
    fireEvent.change(screen.getByRole("textbox", { name: `Player ${i + 1} name` }), {
      target: { value: n },
    });
  });
}

beforeEach(() => {
  localStorage.clear();
  useTournamentStore.setState({ bracket: null, config: null, playingMatchId: null });
  useStore.setState({ gameState: null });
  bridgeLink.setSender(null);
});

describe("Tournament setup", () => {
  it("creates a bracket from the form", () => {
    render(<Tournament />);
    fillNames(["Ann", "Bo", "Cy", "Di"]);
    fireEvent.click(screen.getByRole("button", { name: /create bracket/i }));
    expect(useTournamentStore.getState().bracket?.rounds.map((r) => r.length)).toEqual([2, 1]);
    expect(screen.getByText(/up next/i)).toBeInTheDocument();
  });

  it("surfaces validation errors (duplicate names)", () => {
    render(<Tournament />);
    fillNames(["Ann", "Ann"]);
    fireEvent.click(screen.getByRole("button", { name: /create bracket/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/unique/i);
    expect(useTournamentStore.getState().bracket).toBeNull();
  });

  it("persists the bracket to localStorage", () => {
    render(<Tournament />);
    fillNames(["Ann", "Bo"]);
    fireEvent.click(screen.getByRole("button", { name: /create bracket/i }));
    const raw = JSON.parse(localStorage.getItem("granbridge.tournament")!);
    expect(raw.bracket.players).toEqual(["Ann", "Bo"]);
  });
});

describe("Tournament play", () => {
  function setup4() {
    useTournamentStore.getState().create(["Ann", "Bo", "Cy", "Di"], {
      mode: "x01",
      options: { start_score: 501, double_out: true },
    });
  }

  it("Play this match sends start_game over the bridge", () => {
    const sent: unknown[] = [];
    bridgeLink.setSender((cmd) => sent.push(cmd));
    setup4();
    render(<Tournament />);
    fireEvent.click(screen.getByRole("button", { name: /play this match/i }));
    expect(sent).toEqual([
      { command: "start_game", mode: "x01", players: ["Ann", "Bo"], options: { start_score: 501, double_out: true } },
    ]);
    expect(useTournamentStore.getState().playingMatchId).toBe("m0-0");
    expect(screen.getByText(/winner advances automatically/i)).toBeInTheDocument();
  });

  it("auto-advances when the started game finishes", () => {
    setup4();
    useTournamentStore.getState().setPlayingMatchId("m0-0");
    render(<Tournament />);
    useStore.setState({
      gameState: {
        mode: "x01", status: "finished",
        players: [{ id: "p1", name: "Ann" }, { id: "p2", name: "Bo" }],
        active_index: 0, visit: [], legs: {}, sets: {}, winner: "p2",
        options: {}, mode_view: {}, stats: {},
      } as never,
    });
    // Effect runs on rerender of subscribed state
    expect(useTournamentStore.getState().bracket?.rounds[0][0].winner).toBe(null);
    // Trigger React effect flush
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(useTournamentStore.getState().bracket?.rounds[0][0].winner).toBe("Bo");
        expect(useTournamentStore.getState().playingMatchId).toBeNull();
        resolve();
      }, 0);
    });
  });

  it("ignores a finished game from different players (stale state)", () => {
    setup4();
    useTournamentStore.getState().setPlayingMatchId("m0-0");
    render(<Tournament />);
    useStore.setState({
      gameState: {
        mode: "x01", status: "finished",
        players: [{ id: "p1", name: "Someone" }, { id: "p2", name: "Else" }],
        active_index: 0, visit: [], legs: {}, sets: {}, winner: "p1",
        options: {}, mode_view: {}, stats: {},
      } as never,
    });
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(useTournamentStore.getState().bracket?.rounds[0][0].winner).toBeNull();
        resolve();
      }, 0);
    });
  });

  it("manual winner buttons advance the bracket to a champion", () => {
    setup4();
    render(<Tournament />);
    fireEvent.click(screen.getByRole("button", { name: /mark Ann as winner/i }));
    fireEvent.click(screen.getByRole("button", { name: /mark Cy as winner/i }));
    fireEvent.click(screen.getByRole("button", { name: /mark Ann as winner/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/Ann wins the tournament/i);
  });

  it("abandon requires confirmation and clears storage", () => {
    setup4();
    render(<Tournament />);
    fireEvent.click(screen.getByRole("button", { name: /abandon tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /^yes$/i }));
    expect(useTournamentStore.getState().bracket).toBeNull();
    expect(localStorage.getItem("granbridge.tournament")).toBeNull();
    expect(screen.getByRole("button", { name: /create bracket/i })).toBeInTheDocument();
  });
});
