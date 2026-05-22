import { describe, it, expect, beforeEach } from "vitest";
import { SoundDecider } from "./decide";
import type { Event } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function dartHit(bed: string, score: number): Event {
  return {
    type: "dart_hit",
    bed,
    ring: bed.startsWith("T") ? "T" : bed.startsWith("D") ? "D" : "SO",
    segment: null,
    multiplier: bed.startsWith("T") ? 3 : bed.startsWith("D") ? 2 : 1,
    score,
  };
}

function gameStateWithCheckout(checkout: string[] | null): Event {
  return {
    type: "game_state",
    state: {
      mode: "x01",
      status: "in_progress",
      players: [{ id: "p1", name: "A" }],
      active_index: 0,
      visit: [],
      legs: { p1: 0 },
      sets: { p1: 0 },
      winner: null,
      options: {},
      mode_view: { checkout },
      stats: {},
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("SoundDecider", () => {
  let d: SoundDecider;

  beforeEach(() => {
    d = new SoundDecider();
  });

  // ---- dart_hit classification ------------------------------------------

  it("T20 → hit-treble", () => {
    expect(d.decide(dartHit("T20", 60))).toBe("hit-treble");
  });

  it("T5 → hit-treble", () => {
    expect(d.decide(dartHit("T5", 15))).toBe("hit-treble");
  });

  it("BULL → hit-bull", () => {
    expect(d.decide(dartHit("BULL", 50))).toBe("hit-bull");
  });

  it("DBULL → hit-bull", () => {
    expect(d.decide(dartHit("DBULL", 50))).toBe("hit-bull");
  });

  it("SBULL → hit-bull", () => {
    expect(d.decide(dartHit("SBULL", 25))).toBe("hit-bull");
  });

  it("MISS → miss", () => {
    expect(d.decide(dartHit("MISS", 0))).toBe("miss");
  });

  it("20 (single) → hit", () => {
    expect(d.decide(dartHit("20", 20))).toBe("hit");
  });

  it("D16 (double) → hit", () => {
    expect(d.decide(dartHit("D16", 32))).toBe("hit");
  });

  // ---- one-eighty ---------------------------------------------------------

  it("three T20s → third returns one-eighty", () => {
    expect(d.decide(dartHit("T20", 60))).toBe("hit-treble");
    expect(d.decide(dartHit("T20", 60))).toBe("hit-treble");
    expect(d.decide(dartHit("T20", 60))).toBe("one-eighty");
  });

  it("after one-eighty, visit resets — next dart is hit-treble not one-eighty", () => {
    d.decide(dartHit("T20", 60));
    d.decide(dartHit("T20", 60));
    d.decide(dartHit("T20", 60)); // fires one-eighty, resets
    expect(d.decide(dartHit("T20", 60))).toBe("hit-treble"); // new visit starts
  });

  it("60+60+59 = 179 → third dart is hit-treble, not one-eighty", () => {
    d.decide(dartHit("T20", 60));
    d.decide(dartHit("T20", 60));
    expect(d.decide(dartHit("T19", 57))).toBe("hit-treble");
  });

  // ---- bust ---------------------------------------------------------------

  it("bust event → bust", () => {
    const ev: Event = { type: "bust", player: "p1", score_attempted: 40, reason: "over" };
    expect(d.decide(ev)).toBe("bust");
  });

  it("bust resets visit accumulator", () => {
    d.decide(dartHit("T20", 60));
    d.decide(dartHit("T20", 60));
    d.decide({ type: "bust", player: "p1", score_attempted: 60, reason: "over" });
    // Fresh visit — only 1 dart in, no 180
    expect(d.decide(dartHit("T20", 60))).toBe("hit-treble");
  });

  // ---- leg_won / game_won -------------------------------------------------

  it("leg_won event → leg-won", () => {
    const ev: Event = { type: "leg_won", player: "p1", legs: 1, sets: 0 };
    expect(d.decide(ev)).toBe("leg-won");
  });

  it("game_won event → game-won", () => {
    const ev: Event = { type: "game_won", player: "p1" };
    expect(d.decide(ev)).toBe("game-won");
  });

  // ---- checkout-available -------------------------------------------------

  it("checkout null → present → returns checkout-available", () => {
    expect(d.decide(gameStateWithCheckout(null))).toBeNull();
    expect(d.decide(gameStateWithCheckout(["T20", "D20"]))).toBe("checkout-available");
  });

  it("checkout present → still present → null (no repeat)", () => {
    d.decide(gameStateWithCheckout(null));
    d.decide(gameStateWithCheckout(["T20", "D20"]));
    // Second consecutive present state should NOT fire again
    expect(d.decide(gameStateWithCheckout(["T20", "D20"]))).toBeNull();
  });

  it("checkout absent from start → null", () => {
    expect(d.decide(gameStateWithCheckout(null))).toBeNull();
    expect(d.decide(gameStateWithCheckout(null))).toBeNull();
  });

  it("checkout present → absent → present fires again", () => {
    d.decide(gameStateWithCheckout(["T20", "D20"])); // first-ever: absent→present
    d.decide(gameStateWithCheckout(null));            // present→absent
    expect(d.decide(gameStateWithCheckout(["T16"]))).toBe("checkout-available"); // absent→present again
  });

  it("empty array checkout treated as absent (no sound)", () => {
    d.decide(gameStateWithCheckout(null));
    expect(d.decide(gameStateWithCheckout([]))).toBeNull(); // empty array = absent
  });

  // ---- unrelated events ---------------------------------------------------

  it("connection_state → null", () => {
    const ev: Event = { type: "connection_state", state: "connected", device: null, rssi: null };
    expect(d.decide(ev)).toBeNull();
  });

  it("error event → null", () => {
    const ev: Event = { type: "error", category: "x", message: "y" };
    expect(d.decide(ev)).toBeNull();
  });

  // ---- reset() ------------------------------------------------------------

  it("reset clears checkout tracking", () => {
    d.decide(gameStateWithCheckout(["T20", "D20"])); // fires checkout-available
    d.reset();
    // After reset, same transition should fire again
    expect(d.decide(gameStateWithCheckout(["T20", "D20"]))).toBe("checkout-available");
  });

  it("reset clears visit accumulator mid-visit", () => {
    d.decide(dartHit("T20", 60));
    d.decide(dartHit("T20", 60));
    d.reset(); // reset after 2 darts
    d.decide(dartHit("T20", 60));
    d.decide(dartHit("T20", 60));
    // Only 2 darts in new visit, no 180
    expect(d.decide(dartHit("T19", 57))).toBe("hit-treble"); // 60+60+57 ≠ 180
  });
});
