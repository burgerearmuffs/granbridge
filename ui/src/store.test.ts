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
  it("dart_hit sets lastHit.bed", () => {
    useStore.getState().applyEvent({ type: "dart_hit", bed: "T20", ring: "T", segment: 20, multiplier: 3, score: 60 });
    expect(useStore.getState().lastHit?.bed).toBe("T20");
  });
  it("dart_hit sets lastHit.score", () => {
    useStore.getState().applyEvent({ type: "dart_hit", bed: "D16", ring: "D", segment: 16, multiplier: 2, score: 32 });
    expect(useStore.getState().lastHit?.score).toBe(32);
  });
  it("reset clears lastHit", () => {
    useStore.getState().applyEvent({ type: "dart_hit", bed: "BULL", ring: "SBULL", segment: null, multiplier: 1, score: 25 });
    useStore.getState().reset();
    expect(useStore.getState().lastHit).toBeNull();
  });
});
