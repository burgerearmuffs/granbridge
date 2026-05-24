import { describe, it, expect, beforeEach } from "vitest";
import { getOrCreatePlayer, setPlayerName, setPlayerColor } from "./player";
import { AVATAR_PALETTE } from "./avatar";

const KEY = "granbridge.player";

beforeEach(() => localStorage.clear());

describe("getOrCreatePlayer", () => {
  it("creates a new profile with id, name, and a palette avatar color", () => {
    const p = getOrCreatePlayer();
    expect(p.id).toBeTruthy();
    expect(p.name).toMatch(/^Player-/);
    expect(AVATAR_PALETTE).toContain(p.avatar.color);
  });

  it("migrates a legacy {id,name} record by adding an avatar color and persisting", () => {
    localStorage.setItem(KEY, JSON.stringify({ id: "legacy-1", name: "Bob" }));
    const p = getOrCreatePlayer();
    expect(p.id).toBe("legacy-1");
    expect(p.name).toBe("Bob");
    expect(AVATAR_PALETTE).toContain(p.avatar.color);
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored.avatar.color).toBe(p.avatar.color);
  });

  it("returns the same id on repeated calls (idempotent identity)", () => {
    const a = getOrCreatePlayer();
    const b = getOrCreatePlayer();
    expect(b.id).toBe(a.id);
  });
});

describe("setPlayerName / setPlayerColor", () => {
  it("updates and persists the name", () => {
    getOrCreatePlayer();
    const p = setPlayerName("Zoe");
    expect(p.name).toBe("Zoe");
    expect(JSON.parse(localStorage.getItem(KEY)!).name).toBe("Zoe");
  });
  it("updates and persists the avatar color", () => {
    getOrCreatePlayer();
    const p = setPlayerColor("#123456");
    expect(p.avatar.color).toBe("#123456");
    expect(JSON.parse(localStorage.getItem(KEY)!).avatar.color).toBe("#123456");
  });
});

describe("player writeToken", () => {
  beforeEach(() => localStorage.clear());

  it("creates a writeToken for a brand-new profile", () => {
    const p = getOrCreatePlayer();
    expect(typeof p.writeToken).toBe("string");
    expect(p.writeToken.length).toBeGreaterThan(0);
  });

  it("back-fills writeToken on a legacy {id,name,avatar} record and persists it", () => {
    localStorage.setItem("granbridge.player", JSON.stringify({ id: "abc", name: "Ann", avatar: { color: "#f00" } }));
    const p = getOrCreatePlayer();
    expect(p.writeToken.length).toBeGreaterThan(0);
    const again = getOrCreatePlayer();
    expect(again.writeToken).toBe(p.writeToken); // stable across reads (persisted)
  });
});
