import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useStatsSubmission } from "./useStatsSubmission";
import { useStore } from "../store";
import { useMpStore } from "../multiplayer/store";
import { getOrCreatePlayer, setPlayerName } from "../multiplayer/player";
import { enqueue } from "./statsQueue";
import type { GameState } from "../types";

vi.mock("./statsQueue", () => ({ enqueue: vi.fn(), flush: vi.fn() }));

function Harness() { useStatsSubmission(); return null; }

const FINISHED = (winner: string, players = ["Ann", "Bob"]): GameState => ({
  mode: "x01", status: "finished", players: players.map((n, i) => ({ id: `id${i}`, name: n })),
  active_index: 0, visit: [], legs: {}, sets: {}, winner, options: {}, mode_view: {},
  stats: { Ann: { darts: 9, total_scored: 180, three_dart_avg: 60 }, Bob: { darts: 9, total_scored: 90, three_dart_avg: 30 } },
});

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
  useMpStore.getState().resetMp();
  vi.mocked(enqueue).mockClear();
  setPlayerName("Ann");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("useStatsSubmission", () => {
  it("LOCAL: on finish, fetches export/latest and enqueues my throw-slice", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({
      mode: "x01", players: ["Ann", "Bob"], winner: "Ann", started_at: "s", ended_at: "e",
      throws: [{ player: "Ann", bed: "T20", score: 60, ts: "t" }, { player: "Bob", bed: "S5", score: 5, ts: "t" }],
    }) }));
    render(<Harness />);
    useStore.getState().applyEvent({ type: "game_state", state: { ...FINISHED("Ann"), status: "in_progress" } });
    useStore.getState().applyEvent({ type: "game_state", state: FINISHED("Ann") });
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalled());
    const { record } = vi.mocked(enqueue).mock.calls[0][0];
    expect(record.is_remote).toBe(false);
    expect(record.darts).toBe(1);
    expect(record.total_scored).toBe(60);
    expect(record.winner_id).toBe(getOrCreatePlayer().id);
    expect(record.throws).toHaveLength(1);
  });

  it("REMOTE: with an active remote match, enqueues an aggregate from the snapshot", async () => {
    useMpStore.getState().setRemoteMatchId("shared-1");
    useMpStore.getState().setPeers([{ peer_id: "px", player: { id: "oppId", name: "Bob", avatar: { color: "#0f0" } } }]);
    render(<Harness />);
    useStore.getState().applyEvent({ type: "game_state", state: { ...FINISHED("Ann"), status: "in_progress" } });
    useStore.getState().applyEvent({ type: "game_state", state: FINISHED("Ann") });
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalled());
    const { record } = vi.mocked(enqueue).mock.calls[0][0];
    expect(record.is_remote).toBe(true);
    expect(record.match_id).toBe("shared-1");
    expect(record.opponent_id).toBe("oppId");
    expect(record.darts).toBe(9);
    expect(record.total_scored).toBe(180);
    expect(record.throws).toBeUndefined();
  });

  it("does nothing when the upload toggle is off", async () => {
    localStorage.setItem("granbridge.uploadStats", "false");
    render(<Harness />);
    useStore.getState().applyEvent({ type: "game_state", state: { ...FINISHED("Ann"), status: "in_progress" } });
    useStore.getState().applyEvent({ type: "game_state", state: FINISHED("Ann") });
    await new Promise((r) => setTimeout(r, 0));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("LOCAL: skips upload when my name isn't among the players (hotseat)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({
      mode: "x01", players: ["P1", "P2"], winner: "P1", started_at: "s", ended_at: "e",
      throws: [{ player: "P1", bed: "T20", score: 60, ts: "t" }],
    }) }));
    render(<Harness />);
    useStore.getState().applyEvent({ type: "game_state", state: { ...FINISHED("P1", ["P1", "P2"]), status: "in_progress" } });
    useStore.getState().applyEvent({ type: "game_state", state: FINISHED("P1", ["P1", "P2"]) });
    await new Promise((r) => setTimeout(r, 0));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("LOCAL: does not enqueue when export/latest is not OK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    render(<Harness />);
    useStore.getState().applyEvent({ type: "game_state", state: { ...FINISHED("Ann"), status: "in_progress" } });
    useStore.getState().applyEvent({ type: "game_state", state: FINISHED("Ann") });
    await new Promise((r) => setTimeout(r, 0));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("submits each finished game across two games", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({
      mode: "x01", players: ["Ann"], winner: "Ann", started_at: "s", ended_at: "e",
      throws: [{ player: "Ann", bed: "T20", score: 60, ts: "t" }],
    }) }));
    render(<Harness />);
    useStore.getState().applyEvent({ type: "game_state", state: { ...FINISHED("Ann", ["Ann"]), status: "in_progress" } });
    useStore.getState().applyEvent({ type: "game_state", state: FINISHED("Ann", ["Ann"]) });
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    useStore.getState().applyEvent({ type: "game_state", state: { ...FINISHED("Ann", ["Ann"]), status: "in_progress" } });
    useStore.getState().applyEvent({ type: "game_state", state: FINISHED("Ann", ["Ann"]) });
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
  });

  it("REMOTE: passes identity through and clears remoteMatchId after submit", async () => {
    useMpStore.getState().setRemoteMatchId("shared-1");
    useMpStore.getState().setPeers([{ peer_id: "px", player: { id: "oppId", name: "Bob", avatar: { color: "#0f0" } } }]);
    render(<Harness />);
    useStore.getState().applyEvent({ type: "game_state", state: { ...FINISHED("Ann"), status: "in_progress" } });
    useStore.getState().applyEvent({ type: "game_state", state: FINISHED("Ann") });
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalled());
    const { identity } = vi.mocked(enqueue).mock.calls[0][0];
    expect(identity.id).toBe(getOrCreatePlayer().id);
    expect(identity.writeToken.length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(useMpStore.getState().remoteMatchId).toBeNull());
  });
});
