import { submitMatch } from "./statsClient";
import type { QueueEntry } from "./types";

const KEY = "granbridge.statsQueue";
const TERMINAL = new Set(["implausible", "token_mismatch", "unsupported", "bad_request"]);

type Submit = typeof submitMatch;

function read(): QueueEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueueEntry[]; } catch { return []; }
}
function write(q: QueueEntry[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* ignore */ }
}

export function pendingCount(): number { return read().length; }

/** Append an entry and kick a background flush. */
export function enqueue(entry: QueueEntry): void {
  const q = read();
  q.push(entry);
  write(q);
  void flush();
}

// Serialize all flushes through a single promise chain. A boolean lock would let
// a background flush kicked by enqueue() block a concurrent explicit flush (and
// concurrent flushes could otherwise double-submit or drop entries via the shift).
let chain: Promise<void> = Promise.resolve();

/**
 * Submit queued entries oldest-first. Drops an entry on success or a terminal
 * error; stops (keeping the entry) on a transient/network error. Idempotent —
 * the server dedupes on (match_id, reporter_id). Concurrent calls run serially.
 */
export function flush(submit: Submit = submitMatch): Promise<void> {
  chain = chain.then(() => _flushOnce(submit), () => _flushOnce(submit));
  return chain;
}

async function _flushOnce(submit: Submit): Promise<void> {
  for (;;) {
    const q = read();
    if (q.length === 0) break;
    try {
      await submit(q[0].record, q[0].identity);
    } catch (e) {
      if (!TERMINAL.has((e as Error).message)) break; // transient: keep + stop
      // terminal: fall through to drop
    }
    const q2 = read(); // re-read in case enqueue() appended during the await
    q2.shift();
    write(q2);
  }
}
