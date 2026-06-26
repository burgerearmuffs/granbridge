// ui/src/stats/statsClient.profile.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { updateProfile } from "./statsClient";
import type { Identity } from "./types";

class FakeWS {
  static last: FakeWS | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  readyState = 0;
  constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  reply(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

const IDY: Identity = { id: "P1", writeToken: "tok", name: "Ann", avatarColor: "#f00" };

beforeEach(() => vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket));
afterEach(() => vi.restoreAllMocks());

describe("updateProfile", () => {
  it("sends a profile_update envelope and resolves on profile_ack", async () => {
    const p = updateProfile(IDY, { bio: "love the bull" }, "ws://h");
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(FakeWS.last!.sent[0]);
    expect(sent.type).toBe("profile_update");
    expect(sent.id).toBe("P1");
    expect(sent.writeToken).toBe("tok");
    expect(sent.player.bio).toBe("love the bull");
    expect(sent.player.name).toBe("Ann");        // falls back to identity
    expect(sent.player.avatar.color).toBe("#f00");
    FakeWS.last!.reply({ type: "profile_ack", id: "P1", bio: "love the bull" });
    await expect(p).resolves.toEqual({ id: "P1", bio: "love the bull" });
  });

  it("rejects with the error code on a server error", async () => {
    const p = updateProfile(IDY, { bio: "x" }, "ws://h");
    await new Promise((r) => setTimeout(r, 0));
    FakeWS.last!.reply({ type: "error", code: "token_mismatch", message: "no" });
    await expect(p).rejects.toThrow("token_mismatch");
  });

  it("rejects with timeout when no reply arrives", async () => {
    const p = updateProfile(IDY, { bio: "x" }, "ws://h", 20);
    await expect(p).rejects.toThrow("timeout");
  });
});
