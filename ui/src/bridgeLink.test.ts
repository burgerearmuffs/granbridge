import { describe, it, expect, vi, afterEach } from "vitest";
import { bridgeLink } from "./bridgeLink";
import type { Event } from "./types";

afterEach(() => {
  bridgeLink.setSender(null);
});

const DART: Event = { type: "dart_hit", bed: "T20", ring: "T", segment: 20, multiplier: 3, score: 60 };

describe("bridgeLink", () => {
  it("delivers emitted events to subscribers", () => {
    const seen: Event[] = [];
    const off = bridgeLink.onEvent((e) => seen.push(e));
    bridgeLink.emit(DART);
    expect(seen).toEqual([DART]);
    off();
  });

  it("stops delivering after unsubscribe", () => {
    const seen: Event[] = [];
    const off = bridgeLink.onEvent((e) => seen.push(e));
    off();
    bridgeLink.emit(DART);
    expect(seen).toEqual([]);
  });

  it("routes send() through the registered sender", () => {
    const sender = vi.fn();
    bridgeLink.setSender(sender);
    bridgeLink.send({ command: "next_player" });
    expect(sender).toHaveBeenCalledWith({ command: "next_player" });
  });

  it("send() is a safe no-op when no sender is registered", () => {
    bridgeLink.setSender(null);
    expect(() => bridgeLink.send({ command: "undo" })).not.toThrow();
  });
});
