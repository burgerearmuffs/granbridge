import { describe, it, expect, beforeEach, vi } from "vitest";
import { SoundManager } from "./SoundManager";
import type { SoundPack } from "./SoundManager";
import type { SoundName } from "./decide";
import type { Event } from "../types";

// ---------------------------------------------------------------------------
// Fake pack that records every play() call
// ---------------------------------------------------------------------------
function makeFakePack(): SoundPack & { calls: Array<{ name: SoundName; volume: number }> } {
  const calls: Array<{ name: SoundName; volume: number }> = [];
  return {
    calls,
    play(name: SoundName, volume: number) {
      calls.push({ name, volume });
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers for events
// ---------------------------------------------------------------------------
function dartHitEvent(bed: string, score: number): Event {
  return {
    type: "dart_hit",
    bed,
    ring: bed.startsWith("T") ? "T" : "SO",
    segment: null,
    multiplier: 1,
    score,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("SoundManager", () => {
  beforeEach(() => {
    // Clear localStorage between tests
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("plays hit-treble for a T20 dart_hit when enabled", () => {
    const pack = makeFakePack();
    const mgr = new SoundManager(pack);

    mgr.handleEvent(dartHitEvent("T20", 60));

    expect(pack.calls).toHaveLength(1);
    expect(pack.calls[0].name).toBe("hit-treble");
  });

  it("does NOT call pack.play when disabled", () => {
    const pack = makeFakePack();
    const mgr = new SoundManager(pack);

    mgr.setEnabled(false);
    mgr.handleEvent(dartHitEvent("T20", 60));

    expect(pack.calls).toHaveLength(0);
  });

  it("calling setEnabled(true) after false re-enables sound", () => {
    const pack = makeFakePack();
    const mgr = new SoundManager(pack);

    mgr.setEnabled(false);
    mgr.setEnabled(true);
    mgr.handleEvent(dartHitEvent("T20", 60));

    expect(pack.calls).toHaveLength(1);
  });

  it("passes the current volume to pack.play", () => {
    const pack = makeFakePack();
    const mgr = new SoundManager(pack);

    mgr.setVolume(0.42);
    mgr.handleEvent(dartHitEvent("20", 20));

    expect(pack.calls[0].volume).toBeCloseTo(0.42);
  });

  it("setVolume persists to localStorage under granbridge.sound", () => {
    const pack = makeFakePack();
    const mgr = new SoundManager(pack);

    mgr.setVolume(0.7);

    const stored = JSON.parse(localStorage.getItem("granbridge.sound") ?? "{}");
    expect(stored.volume).toBeCloseTo(0.7);
  });

  it("setEnabled persists to localStorage", () => {
    const pack = makeFakePack();
    const mgr = new SoundManager(pack);

    mgr.setEnabled(false);

    const stored = JSON.parse(localStorage.getItem("granbridge.sound") ?? "{}");
    expect(stored.enabled).toBe(false);
  });

  it("loads persisted prefs from localStorage on construction", () => {
    localStorage.setItem("granbridge.sound", JSON.stringify({ enabled: false, volume: 0.3 }));

    const pack = makeFakePack();
    const mgr = new SoundManager(pack);

    expect(mgr.getEnabled()).toBe(false);
    expect(mgr.getVolume()).toBeCloseTo(0.3);
  });

  it("handles a bust event → pack called with 'bust'", () => {
    const pack = makeFakePack();
    const mgr = new SoundManager(pack);

    const ev: Event = { type: "bust", player: "p1", score_attempted: 40, reason: "over" };
    mgr.handleEvent(ev);

    expect(pack.calls[0]?.name).toBe("bust");
  });

  it("handles leg_won → pack called with 'leg-won'", () => {
    const pack = makeFakePack();
    const mgr = new SoundManager(pack);

    const ev: Event = { type: "leg_won", player: "p1", legs: 1, sets: 0 };
    mgr.handleEvent(ev);

    expect(pack.calls[0]?.name).toBe("leg-won");
  });

  it("handles game_won → pack called with 'game-won'", () => {
    const pack = makeFakePack();
    const mgr = new SoundManager(pack);

    const ev: Event = { type: "game_won", player: "p1" };
    mgr.handleEvent(ev);

    expect(pack.calls[0]?.name).toBe("game-won");
  });

  it("clamps volume to [0, 1]", () => {
    const pack = makeFakePack();
    const mgr = new SoundManager(pack);

    mgr.setVolume(1.5);
    mgr.handleEvent(dartHitEvent("20", 20));
    expect(pack.calls[0].volume).toBe(1);

    pack.calls.length = 0;

    mgr.setVolume(-0.5);
    mgr.handleEvent(dartHitEvent("20", 20));
    expect(pack.calls[0].volume).toBe(0);
  });

  it("connection_state event fires no sound", () => {
    const pack = makeFakePack();
    const mgr = new SoundManager(pack);

    const ev: Event = { type: "connection_state", state: "connected", device: null, rssi: null };
    mgr.handleEvent(ev);

    expect(pack.calls).toHaveLength(0);
  });

  it("three T20 hits produce one-eighty on the third", () => {
    const pack = makeFakePack();
    const mgr = new SoundManager(pack);

    mgr.handleEvent(dartHitEvent("T20", 60));
    mgr.handleEvent(dartHitEvent("T20", 60));
    mgr.handleEvent(dartHitEvent("T20", 60));

    const names = pack.calls.map((c) => c.name);
    expect(names).toEqual(["hit-treble", "hit-treble", "one-eighty"]);
  });
});
