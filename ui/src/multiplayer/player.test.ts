import { describe, it, expect, beforeEach } from "vitest";
import { getOrCreatePlayer, setPlayerName } from "./player";

// jsdom provides localStorage — just clear it between tests.
beforeEach(() => localStorage.clear());

describe("player identity", () => {
  it("creates a new identity on first call", () => {
    const p = getOrCreatePlayer();
    expect(p.id).toBeTruthy();
    expect(p.name).toMatch(/^Player-/);
  });

  it("persists: second call returns the same id", () => {
    const first = getOrCreatePlayer();
    const second = getOrCreatePlayer();
    expect(second.id).toBe(first.id);
  });

  it("name follows id prefix by default", () => {
    const p = getOrCreatePlayer();
    expect(p.name).toBe(`Player-${p.id.slice(0, 6)}`);
  });

  it("setPlayerName updates the name and persists it", () => {
    getOrCreatePlayer();
    const updated = setPlayerName("Tina");
    expect(updated.name).toBe("Tina");
    // Subsequent getOrCreatePlayer must return updated name
    expect(getOrCreatePlayer().name).toBe("Tina");
  });

  it("setPlayerName preserves the id", () => {
    const original = getOrCreatePlayer();
    const updated = setPlayerName("Bob");
    expect(updated.id).toBe(original.id);
  });
});
