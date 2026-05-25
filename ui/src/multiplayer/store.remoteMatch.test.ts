// ui/src/multiplayer/store.remoteMatch.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useMpStore } from "./store";

beforeEach(() => useMpStore.getState().resetMp());

describe("mp store remoteMatchId", () => {
  it("sets and clears the remote match id", () => {
    useMpStore.getState().setRemoteMatchId("m-1");
    expect(useMpStore.getState().remoteMatchId).toBe("m-1");
    useMpStore.getState().resetMp();
    expect(useMpStore.getState().remoteMatchId).toBeNull();
  });
});
