// ui/src/stats/statsQueue.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { enqueue, flush, pendingCount } from "./statsQueue";
import type { QueueEntry } from "./types";

// enqueue() kicks a background flush() that uses the real submitMatch (which opens
// a WebSocket to the default broker). Mock it so these tests never touch the network
// — a transient rejection keeps the entry without draining; the explicit flush(submit)
// calls below pass their own mock for the actual assertions.
vi.mock("./statsClient", () => ({
  submitMatch: vi.fn().mockRejectedValue(new Error("ws_error")),
}));

const entry = (match_id: string): QueueEntry => ({
  record: { match_id, mode: "x01", opponent_id: null, winner_id: "P1", is_remote: false,
            darts: 9, total_scored: 180, started_at: "s", ended_at: "e" },
  identity: { id: "P1", writeToken: "t", name: "Ann", avatarColor: "#f00" },
});

beforeEach(() => localStorage.clear());

describe("statsQueue", () => {
  it("flushes entries that submit successfully and drains the queue", async () => {
    const submit = vi.fn().mockResolvedValue({ match_id: "m1", verified: false });
    enqueue(entry("m1")); enqueue(entry("m2"));
    await flush(submit);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(pendingCount()).toBe(0);
  });

  it("keeps an entry on a transient error and stops (retries later)", async () => {
    const submit = vi.fn().mockRejectedValue(new Error("timeout"));
    enqueue(entry("m1"));
    await flush(submit);
    expect(pendingCount()).toBe(1); // kept
  });

  it("drops an entry on a terminal error", async () => {
    const submit = vi.fn().mockRejectedValue(new Error("implausible"));
    enqueue(entry("m1"));
    await flush(submit);
    expect(pendingCount()).toBe(0); // dropped
  });
});
