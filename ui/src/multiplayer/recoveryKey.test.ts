// ui/src/multiplayer/recoveryKey.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { exportRecoveryKey, importRecoveryKey } from "./recoveryKey";
import { getOrCreatePlayer, applyRecoveryKey } from "./player";

describe("recoveryKey codec", () => {
  it("round-trips id + writeToken", () => {
    const key = exportRecoveryKey({ id: "id-1", writeToken: "tok-1" });
    expect(importRecoveryKey(key)).toEqual({ id: "id-1", writeToken: "tok-1" });
  });

  it("rejects malformed keys", () => {
    expect(() => importRecoveryKey("not-base64-$$")).toThrow();
    expect(() => importRecoveryKey(btoa("wrongprefix:a:b"))).toThrow();
    expect(() => importRecoveryKey(btoa("granbridge:onlyone"))).toThrow();
  });
});

describe("applyRecoveryKey", () => {
  beforeEach(() => localStorage.clear());
  it("replaces the persisted identity with the imported id+token", () => {
    getOrCreatePlayer(); // seed some identity
    const p = applyRecoveryKey(exportRecoveryKey({ id: "restored", writeToken: "rtok" }));
    expect(p.id).toBe("restored");
    expect(p.writeToken).toBe("rtok");
    expect(getOrCreatePlayer().id).toBe("restored"); // persisted
  });
});
