import { describe, it, expect } from "vitest";
import { AVATAR_PALETTE, defaultAvatarColor, initials } from "./avatar";

describe("defaultAvatarColor", () => {
  it("returns a palette color", () => {
    expect(AVATAR_PALETTE).toContain(defaultAvatarColor("abc123"));
  });
  it("is deterministic for the same id", () => {
    expect(defaultAvatarColor("user-xyz")).toBe(defaultAvatarColor("user-xyz"));
  });
});

describe("initials", () => {
  it("uses the first letter of the first two tokens", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("Player-a1b2c3")).toBe("PA");
  });
  it("uses the first two chars of a single token", () => {
    expect(initials("Ada")).toBe("AD");
  });
  it("returns '?' for an empty/whitespace name", () => {
    expect(initials("   ")).toBe("?");
  });
});
