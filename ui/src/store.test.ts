import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";

const sampleState = { mode: "x01", status: "in_progress", players: [{id:"p1",name:"A"}], active_index: 0,
  visit: [], legs: {p1:0}, sets: {p1:0}, winner: null, options: {}, mode_view: { scores: { p1: 441 } }, stats: {} } as any;

describe("store", () => {
  beforeEach(() => useStore.getState().reset());
  it("applies game_state", () => {
    useStore.getState().applyEvent({ type: "game_state", state: sampleState });
    expect(useStore.getState().gameState?.mode_view.scores.p1).toBe(441);
  });
  it("tracks connection", () => {
    useStore.getState().setConnection("connected");
    expect(useStore.getState().connection).toBe("connected");
  });
  it("rings banners and caps at 5", () => {
    for (let i=0;i<7;i++) useStore.getState().applyEvent({ type:"bust", player:"p1", score_attempted:1, reason:"x" });
    expect(useStore.getState().banners.length).toBe(5);
  });
});
