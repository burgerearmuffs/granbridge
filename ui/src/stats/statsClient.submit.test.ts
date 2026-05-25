// ui/src/stats/statsClient.submit.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { submitMatch } from "./statsClient";
import type { MatchRecord, Identity } from "./types";

// Minimal fake WebSocket the test drives.
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

const REC: MatchRecord = {
  match_id: "m1", mode: "x01", opponent_id: null, winner_id: "P1", is_remote: false,
  darts: 9, total_scored: 180, started_at: "2026-05-24T10:00:00.000Z", ended_at: "2026-05-24T10:05:00.000Z",
};
const IDY: Identity = { id: "P1", writeToken: "tok", name: "Ann", avatarColor: "#f00" };

beforeEach(() => vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket));
afterEach(() => vi.restoreAllMocks());

describe("submitMatch", () => {
  it("sends a stats_submit envelope and resolves on stats_ack", async () => {
    const p = submitMatch(REC, IDY, "ws://h");
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(FakeWS.last!.sent[0]);
    expect(sent.type).toBe("stats_submit");
    expect(sent.id).toBe("P1");
    expect(sent.writeToken).toBe("tok");
    expect(sent.player.avatar.color).toBe("#f00");
    expect(sent.match.match_id).toBe("m1");
    FakeWS.last!.reply({ type: "stats_ack", match_id: "m1", verified: false });
    await expect(p).resolves.toEqual({ match_id: "m1", verified: false });
  });

  it("rejects with the error code on a server error", async () => {
    const p = submitMatch(REC, IDY, "ws://h");
    await new Promise((r) => setTimeout(r, 0));
    FakeWS.last!.reply({ type: "error", code: "token_mismatch", message: "no" });
    await expect(p).rejects.toThrow("token_mismatch");
  });

  it("rejects with timeout when no reply arrives", async () => {
    const p = submitMatch(REC, IDY, "ws://h", 20);
    await expect(p).rejects.toThrow("timeout");
  });
});
