# Server-Side Stats — Client Foundation & Ingestion (Plan 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make finished matches flow to the stats backend — durable `writeToken` identity + recovery codec, a `statsClient` (WS submit + HTTP reads), an offline queue, an app `export/latest` endpoint, and a submit-on-game-over hook with two assembly paths (local full-throws vs remote aggregate).

**Architecture:** New `ui/src/stats/` module owns the client (`statsClient`, `statsQueue`, `uploadPref`, `useStatsSubmission`, `types`); identity gains a `writeToken` (`player.ts`) with a pure `recoveryKey.ts` codec; the remote `match_id` is host-minted and shared over the existing data channel (`remoteMatch.ts` + `multiplayer/store.ts`); one new Python endpoint exposes the canonical local match. Writes ride a transient WebSocket `stats_submit`; reads are HTTP GET to the broker host.

**Tech Stack:** React + TypeScript + Vite + Zustand, vitest + jsdom + @testing-library/react (mock `globalThis.fetch` and a fake `WebSocket`); Python 3.14 + SQLite (stdlib).

**This is Plan 2a of 2 for the client** (Plan 2b adds the read *surfaces*: Profile recovery UI + server card + toggle, opponent card from server, Leaderboard view). The backend (Plan 1) is on branch `server-side-stats`; this branch (`server-side-stats-client`) is based on it, so the broker stats API is present for reference/integration.

**Spec:** `docs/superpowers/specs/2026-05-24-server-side-stats-client-design.md`.

**Commands:** UI tests `npm --prefix ui run test`; UI typecheck/build `npm --prefix ui run build`. Python tests from repo root `python -m pytest tests/test_history_export.py -q`. Branch: `server-side-stats-client`.

**Backend contract this client speaks to (from Plan 1, already built):**
- WS write: send `{type:"stats_submit", id, writeToken, player:{id,name,avatar:{color}}, match:<MatchRecord>}` → reply `{type:"stats_ack", match_id, verified}` or `{type:"error", code}` (codes: `implausible`, `token_mismatch`, `unsupported`, `rate_limited`, `bad_request`). No room join required.
- HTTP reads: `GET /stats/player/{id}` → player summary JSON; `GET /stats/leaderboard?metric=avg|wins&limit=N` → `{metric, players:[...]}`.
- `MatchRecord` = `{match_id, mode, opponent_id, winner_id, is_remote, darts, total_scored, started_at, ended_at, throws?}`. `started_at` is REQUIRED by the server; `throws` is optional; `total_scored ≤ darts*60`.

---

## File Structure
- **Modify** `ui/src/multiplayer/player.ts` — add `writeToken` to `Profile` + migration; add `applyRecoveryKey`.
- **Create** `ui/src/multiplayer/recoveryKey.ts` — pure encode/decode codec (no persistence).
- **Create** `ui/src/stats/types.ts` — `MatchRecord`, `PlayerSummary`, `LeaderRow`, `Identity`, `QueueEntry`.
- **Create** `ui/src/stats/statsClient.ts` — `brokerHttpBase`, `submitMatch`, `fetchPlayerSummary`, `fetchLeaderboard`.
- **Create** `ui/src/stats/statsQueue.ts` — localStorage FIFO + `enqueue`/`flush`.
- **Create** `ui/src/stats/uploadPref.ts` — `getUploadEnabled`/`setUploadEnabled`.
- **Create** `ui/src/stats/useStatsSubmission.ts` — game-over watcher + two assembly paths.
- **Modify** `ui/src/multiplayer/remoteMatch.ts` — `{t:"matchid",id}` SyncMsg + `onMatchId`.
- **Modify** `ui/src/multiplayer/store.ts` — `remoteMatchId` + setter + clear on `resetMp`.
- **Modify** `ui/src/views/Multiplayer.tsx` — pass `onMatchId` to `RemoteMatch`.
- **Modify** `ui/src/App.tsx` — mount `useStatsSubmission()` + flush the queue on startup.
- **Modify** `src/granbridge/history/store.py` — `export_latest_match()`.
- **Modify** `src/granbridge/cli.py` — register `/api/history/export/latest`.
- **Create tests** alongside each.

---

## Task 1: `player.ts` — add `writeToken` + migration

**Files:**
- Modify: `ui/src/multiplayer/player.ts`
- Test: `ui/src/multiplayer/player.test.ts` (append; create if absent)

- [ ] **Step 1: Write the failing test**

```ts
// append to ui/src/multiplayer/player.test.ts (create the file with these imports if it doesn't exist)
import { describe, it, expect, beforeEach } from "vitest";
import { getOrCreatePlayer } from "./player";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ui run test -- player.test`
Expected: FAIL — `writeToken` is `undefined`.

- [ ] **Step 3: Implement**

In `ui/src/multiplayer/player.ts`, add `writeToken` to the interface and migrate. Replace the `Profile` interface and `getOrCreatePlayer` body:

```ts
export interface Profile {
  id: string;
  name: string;
  avatar: AvatarSpec;
  writeToken: string;
}

const STORAGE_KEY = "granbridge.player";

/** Return the persisted profile (migrating legacy records), or create one. */
export function getOrCreatePlayer(): Profile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        id?: string; name?: string; avatar?: { color?: unknown }; writeToken?: unknown;
      };
      if (parsed.id && parsed.name) {
        const hasColor = parsed.avatar && typeof parsed.avatar.color === "string";
        const hasToken = typeof parsed.writeToken === "string" && parsed.writeToken.length > 0;
        const profile: Profile = {
          id: parsed.id,
          name: parsed.name,
          avatar: { color: hasColor ? (parsed.avatar!.color as string) : defaultAvatarColor(parsed.id) },
          writeToken: hasToken ? (parsed.writeToken as string) : crypto.randomUUID(),
        };
        if (!hasColor || !hasToken) _persist(profile);
        return profile;
      }
    }
  } catch {
    /* ignore corrupt storage */
  }
  const id = crypto.randomUUID();
  const profile: Profile = {
    id, name: `Player-${id.slice(0, 6)}`,
    avatar: { color: defaultAvatarColor(id) }, writeToken: crypto.randomUUID(),
  };
  _persist(profile);
  return profile;
}
```

(Leave `setPlayerName`, `setPlayerColor`, `_persist` unchanged — spreading `...getOrCreatePlayer()` / `...current` now carries `writeToken` through.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ui run test -- player.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/multiplayer/player.ts ui/src/multiplayer/player.test.ts
git commit -m "feat(ui): add writeToken to Profile with legacy migration"
```

---

## Task 2: `recoveryKey.ts` codec + `applyRecoveryKey`

**Files:**
- Create: `ui/src/multiplayer/recoveryKey.ts`
- Modify: `ui/src/multiplayer/player.ts` (add `applyRecoveryKey`)
- Test: `ui/src/multiplayer/recoveryKey.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ui run test -- recoveryKey.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `ui/src/multiplayer/recoveryKey.ts`:

```ts
/** Pure recovery-key codec: base64("granbridge:" + id + ":" + writeToken). No persistence. */
const PREFIX = "granbridge";

export function exportRecoveryKey(idy: { id: string; writeToken: string }): string {
  return btoa(`${PREFIX}:${idy.id}:${idy.writeToken}`);
}

export function importRecoveryKey(key: string): { id: string; writeToken: string } {
  let decoded: string;
  try {
    decoded = atob(key.trim());
  } catch {
    throw new Error("invalid recovery key");
  }
  const parts = decoded.split(":");
  if (parts.length !== 3 || parts[0] !== PREFIX || !parts[1] || !parts[2]) {
    throw new Error("invalid recovery key");
  }
  return { id: parts[1], writeToken: parts[2] };
}
```

In `ui/src/multiplayer/player.ts`, add an import and a function:

```ts
import { importRecoveryKey } from "./recoveryKey";
```

```ts
/** Restore identity from a recovery key (replaces this device's id + writeToken). */
export function applyRecoveryKey(key: string): Profile {
  const { id, writeToken } = importRecoveryKey(key); // throws on malformed
  const current = getOrCreatePlayer();
  const updated: Profile = { ...current, id, writeToken, avatar: { color: defaultAvatarColor(id) } };
  _persist(updated);
  return updated;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ui run test -- recoveryKey.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/multiplayer/recoveryKey.ts ui/src/multiplayer/recoveryKey.test.ts ui/src/multiplayer/player.ts
git commit -m "feat(ui): recovery-key codec + applyRecoveryKey"
```

---

## Task 3: `stats/types.ts` + `statsClient` reads (`brokerHttpBase`, `fetchPlayerSummary`, `fetchLeaderboard`)

**Files:**
- Create: `ui/src/stats/types.ts`, `ui/src/stats/statsClient.ts`
- Test: `ui/src/stats/statsClient.reads.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/stats/statsClient.reads.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { brokerHttpBase, fetchPlayerSummary, fetchLeaderboard } from "./statsClient";

afterEach(() => vi.restoreAllMocks());

describe("brokerHttpBase", () => {
  it("maps ws->http and wss->https and strips trailing slash", () => {
    expect(brokerHttpBase("wss://darts.example.com/")).toBe("https://darts.example.com");
    expect(brokerHttpBase("ws://127.0.0.1:8788")).toBe("http://127.0.0.1:8788");
  });
});

describe("reads", () => {
  it("fetchPlayerSummary hits /stats/player/{id} on the broker host", async () => {
    const body = { id: "P1", games_played: 2, wins: 1, three_dart_avg: 50, verified_games: 1, heatmap: {} };
    const f = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
    vi.stubGlobal("fetch", f);
    const out = await fetchPlayerSummary("P1", "https://h");
    expect(f).toHaveBeenCalledWith("https://h/stats/player/P1");
    expect(out.three_dart_avg).toBe(50);
  });

  it("fetchLeaderboard passes metric+limit and returns players", async () => {
    const body = { metric: "wins", players: [{ id: "P1", wins: 3 }] };
    const f = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
    vi.stubGlobal("fetch", f);
    const out = await fetchLeaderboard("wins", 5, "https://h");
    expect(f).toHaveBeenCalledWith("https://h/stats/leaderboard?metric=wins&limit=5");
    expect(out.players[0].id).toBe("P1");
  });

  it("throws on non-OK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchPlayerSummary("P1", "https://h")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ui run test -- statsClient.reads`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `ui/src/stats/types.ts`:

```ts
export interface MatchRecord {
  match_id: string;
  mode: string;
  opponent_id: string | null;
  winner_id: string | null;
  is_remote: boolean;
  darts: number;
  total_scored: number;
  started_at: string;
  ended_at: string;
  throws?: { bed: string; score: number; ts: string }[];
}

export interface Identity {
  id: string;
  writeToken: string;
  name: string;
  avatarColor: string;
}

export interface PlayerSummary {
  id: string;
  display_name: string | null;
  avatar_color: string | null;
  games_played: number;
  wins: number;
  verified_games: number;
  darts: number;
  total_scored: number;
  three_dart_avg: number;
  heatmap: Record<string, number>;
}

export interface LeaderRow {
  id: string;
  display_name: string | null;
  avatar_color: string | null;
  games: number;
  wins: number;
  three_dart_avg: number;
}

export interface QueueEntry {
  record: MatchRecord;
  identity: Identity;
}
```

Create `ui/src/stats/statsClient.ts` (reads first; `submitMatch` added in Task 4):

```ts
import { readBrokerUrl } from "../multiplayer/store";
import type { PlayerSummary, LeaderRow } from "./types";

/** Map the broker WS URL to its HTTP origin (ws->http, wss->https; trailing slash stripped). */
export function brokerHttpBase(wsUrl: string = readBrokerUrl()): string {
  let base = wsUrl.trim();
  if (base.startsWith("wss://")) base = "https://" + base.slice(6);
  else if (base.startsWith("ws://")) base = "http://" + base.slice(5);
  return base.replace(/\/+$/, "");
}

export async function fetchPlayerSummary(id: string, base: string = brokerHttpBase()): Promise<PlayerSummary> {
  const res = await fetch(`${base}/stats/player/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`stats/player ${res.status}`);
  return (await res.json()) as PlayerSummary;
}

export async function fetchLeaderboard(
  metric: "avg" | "wins", limit = 20, base: string = brokerHttpBase(),
): Promise<{ metric: string; players: LeaderRow[] }> {
  const res = await fetch(`${base}/stats/leaderboard?metric=${metric}&limit=${limit}`);
  if (!res.ok) throw new Error(`stats/leaderboard ${res.status}`);
  return (await res.json()) as { metric: string; players: LeaderRow[] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ui run test -- statsClient.reads`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/stats/types.ts ui/src/stats/statsClient.ts ui/src/stats/statsClient.reads.test.ts
git commit -m "feat(ui): stats types + statsClient reads (brokerHttpBase, player, leaderboard)"
```

---

## Task 4: `statsClient.submitMatch` (transient WS)

**Files:**
- Modify: `ui/src/stats/statsClient.ts`
- Test: `ui/src/stats/statsClient.submit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
    await Promise.resolve();
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
    await Promise.resolve();
    FakeWS.last!.reply({ type: "error", code: "token_mismatch", message: "no" });
    await expect(p).rejects.toThrow("token_mismatch");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ui run test -- statsClient.submit`
Expected: FAIL — `submitMatch` not exported.

- [ ] **Step 3: Implement**

Append to `ui/src/stats/statsClient.ts`:

```ts
import type { MatchRecord, Identity } from "./types";

/** Submit a match over a transient WebSocket; resolves on stats_ack, rejects Error(code) otherwise. */
export function submitMatch(
  record: MatchRecord, identity: Identity,
  wsUrl: string = readBrokerUrl(), timeoutMs = 8000,
): Promise<{ match_id: string; verified: boolean }> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      reject(e instanceof Error ? e : new Error("ws_construct"));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("timeout"))), timeoutMs);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "stats_submit",
        id: identity.id,
        writeToken: identity.writeToken,
        player: { id: identity.id, name: identity.name, avatar: { color: identity.avatarColor } },
        match: record,
      }));
    };
    ws.onmessage = (ev: MessageEvent) => {
      let msg: { type?: string; match_id?: string; verified?: boolean; code?: string };
      try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : ""); } catch { return; }
      if (msg.type === "stats_ack") finish(() => resolve({ match_id: msg.match_id ?? record.match_id, verified: !!msg.verified }));
      else if (msg.type === "error") finish(() => reject(new Error(msg.code || "error")));
    };
    ws.onerror = () => finish(() => reject(new Error("ws_error")));
    ws.onclose = () => finish(() => reject(new Error("closed")));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ui run test -- statsClient.submit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/stats/statsClient.ts ui/src/stats/statsClient.submit.test.ts
git commit -m "feat(ui): statsClient.submitMatch over a transient WebSocket"
```

---

## Task 5: `statsQueue.ts` (offline queue)

**Files:**
- Create: `ui/src/stats/statsQueue.ts`
- Test: `ui/src/stats/statsQueue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/stats/statsQueue.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { enqueue, flush, pendingCount } from "./statsQueue";
import type { QueueEntry } from "./types";

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
```

(Note: `enqueue` triggers a background `flush()` with the real `submitMatch`; in jsdom `new WebSocket` will error → `closed`/`ws_error` (transient), leaving the entry queued, so the explicit `flush(submit)` call drives the deterministic assertion. The auto-flush is fire-and-forget and harmless here.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ui run test -- statsQueue`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `ui/src/stats/statsQueue.ts`:

```ts
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

let flushing = false;

/** Append an entry and kick a background flush. */
export function enqueue(entry: QueueEntry): void {
  const q = read();
  q.push(entry);
  write(q);
  void flush();
}

/**
 * Submit queued entries oldest-first. Drops an entry on success or a terminal
 * error; stops (keeping the entry) on a transient/network error. Idempotent —
 * the server dedupes on (match_id, reporter_id).
 */
export async function flush(submit: Submit = submitMatch): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
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
  } finally {
    flushing = false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ui run test -- statsQueue`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/stats/statsQueue.ts ui/src/stats/statsQueue.test.ts
git commit -m "feat(ui): offline stats queue (localStorage, terminal/transient handling)"
```

---

## Task 6: `uploadPref.ts` (upload toggle helper)

**Files:**
- Create: `ui/src/stats/uploadPref.ts`
- Test: `ui/src/stats/uploadPref.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/stats/uploadPref.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { getUploadEnabled, setUploadEnabled } from "./uploadPref";

beforeEach(() => localStorage.clear());

describe("uploadPref", () => {
  it("defaults to enabled", () => { expect(getUploadEnabled()).toBe(true); });
  it("round-trips false/true", () => {
    setUploadEnabled(false); expect(getUploadEnabled()).toBe(false);
    setUploadEnabled(true); expect(getUploadEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ui run test -- uploadPref`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `ui/src/stats/uploadPref.ts`:

```ts
/** Global "upload my stats" preference (default ON), following the VideoToggle localStorage pattern. */
const KEY = "granbridge.uploadStats";

export function getUploadEnabled(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? true : v === "true";
  } catch {
    return true;
  }
}

export function setUploadEnabled(v: boolean): void {
  try { localStorage.setItem(KEY, String(v)); } catch { /* ignore */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ui run test -- uploadPref`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/stats/uploadPref.ts ui/src/stats/uploadPref.test.ts
git commit -m "feat(ui): upload-stats preference helper (default on)"
```

---

## Task 7: Python `export_latest_match` + route

**Files:**
- Modify: `src/granbridge/history/store.py`
- Modify: `src/granbridge/cli.py`
- Test: `tests/test_history_export.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_history_export.py
import shutil
import tempfile
from pathlib import Path

from granbridge.history.store import HistoryStore


def _store():
    # NOTE: this environment's pytest tmp_path fixture hits a PermissionError on
    # Temp\pytest-of-<user>; mkdtemp to the temp ROOT works, so use it directly.
    d = Path(tempfile.mkdtemp())
    return HistoryStore(d / "hist.db"), d


def test_export_latest_returns_finished_game_with_throws():
    store, d = _store()
    try:
        gid = store.start_game("x01", ["Ann", "Bob"], {"start_score": 501})
        store.record_throw(gid, "Ann", "T20", 60)
        store.record_throw(gid, "Bob", "S5", 5)
        store.end_game(gid, "Ann")
        rec = store.export_latest_match()
        assert rec["mode"] == "x01"
        assert rec["players"] == ["Ann", "Bob"]
        assert rec["winner"] == "Ann"
        assert rec["started_at"] and rec["ended_at"]
        beds = {(t["player"], t["bed"], t["score"]) for t in rec["throws"]}
        assert ("Ann", "T20", 60) in beds and ("Bob", "S5", 5) in beds
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_export_latest_empty_when_no_finished_game():
    store, d = _store()
    try:
        store.start_game("x01", ["Ann"], {})  # not ended
        assert store.export_latest_match() == {}
    finally:
        shutil.rmtree(d, ignore_errors=True)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_history_export.py -q`
Expected: FAIL — `AttributeError: 'HistoryStore' object has no attribute 'export_latest_match'`.

- [ ] **Step 3: Implement**

In `src/granbridge/history/store.py`, add a method to `HistoryStore`:

```python
    def export_latest_match(self) -> dict:
        """The most recent finished game as a canonical record (throws carry player)."""
        with _connect(self.db_path) as conn:
            g = conn.execute(
                "SELECT * FROM games WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if g is None:
                return {}
            throws = conn.execute(
                "SELECT player, bed, score, ts FROM throws WHERE game_id = ? ORDER BY id",
                (g["id"],),
            ).fetchall()
        return {
            "mode": g["mode"],
            "players": json.loads(g["players_json"]),
            "winner": g["winner"],
            "started_at": g["started_at"],
            "ended_at": g["ended_at"],
            "throws": [
                {"player": t["player"], "bed": t["bed"], "score": t["score"], "ts": t["ts"]}
                for t in throws
            ],
        }
```

In `src/granbridge/cli.py`, add to the `routes={...}` dict passed to `StaticServer` (alongside the other `/api/history/*` entries):

```python
                "/api/history/export/latest": store.export_latest_match,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_history_export.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/granbridge/history/store.py src/granbridge/cli.py tests/test_history_export.py
git commit -m "feat(app): /api/history/export/latest — canonical latest finished match"
```

---

## Task 8: `remoteMatch.ts` — `matchid` SyncMsg + `onMatchId`

**Files:**
- Modify: `ui/src/multiplayer/remoteMatch.ts`
- Test: `ui/src/multiplayer/remoteMatch.matchid.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/multiplayer/remoteMatch.matchid.test.ts
import { describe, it, expect, vi } from "vitest";
import { RemoteMatch } from "./remoteMatch";
import type { Command, Event } from "../types";

function fakePeer() {
  const sent: unknown[] = [];
  return {
    sent,
    sendData(o: unknown) { sent.push(o); },
    onDataMessage: (_p: string, _o: unknown) => {},
    onChannelOpen: (_p: string) => {},
  };
}
function fakeBridge() {
  return { send(_c: Command) {}, onEvent(_cb: (e: Event) => void) { return () => {}; } };
}

describe("remote match_id sharing", () => {
  it("host mints + sends a matchid and notifies onMatchId on startGame", () => {
    const peer = fakePeer();
    const onMatchId = vi.fn();
    const rm = new RemoteMatch({ role: "host", peer, bridge: fakeBridge(),
      applyState: () => {}, onMatchId });
    rm.start();
    rm.startGame("x01", ["Ann", "Bob"], {});
    const sentIds = peer.sent.filter((m) => (m as { t?: string }).t === "matchid");
    expect(sentIds).toHaveLength(1);
    const id = (sentIds[0] as { id: string }).id;
    expect(onMatchId).toHaveBeenCalledWith(id);
  });

  it("guest forwards a received matchid to onMatchId", () => {
    const peer = fakePeer();
    const onMatchId = vi.fn();
    const rm = new RemoteMatch({ role: "guest", peer, bridge: fakeBridge(),
      applyState: () => {}, onMatchId });
    rm.start();
    peer.onDataMessage("x", { t: "matchid", id: "shared-1" });
    expect(onMatchId).toHaveBeenCalledWith("shared-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ui run test -- remoteMatch.matchid`
Expected: FAIL — `onMatchId` unused / matchid not sent.

- [ ] **Step 3: Implement**

In `ui/src/multiplayer/remoteMatch.ts`:

Extend the union (add the `matchid` variant):

```ts
export type SyncMsg =
  | { t: "state"; state: GameState }
  | { t: "dart"; bed: string }
  | { t: "card"; profile: Profile; summary: CareerSummary }
  | { t: "matchid"; id: string };
```

Add to `RemoteMatchOptions` (after `onOpponentCard`):

```ts
  /** Called with the shared remote match id (host on mint, guest on receive). */
  onMatchId?: (id: string) => void;
```

In `isSyncMsg`, add before the final `return false;`:

```ts
  if (t === "matchid") return typeof (o as { id?: unknown }).id === "string";
```

Update the constructor defaults to include `onMatchId`:

```ts
    this._opts = { hostSlot: "p1", guestSlot: "p2", selfCard: null, onOpponentCard: () => {}, onMatchId: () => {}, ...opts };
```

Add a private field and mint logic. Add near the other private fields:

```ts
  private _matchId: string | null = null;
```

In `startGame` (host), mint + share + notify before sending the start command:

```ts
  startGame(mode: string, players: string[], options: Record<string, unknown>): void {
    if (this._opts.role !== "host") return;
    this._matchId = crypto.randomUUID();
    this._opts.peer.sendData({ t: "matchid", id: this._matchId });
    this._opts.onMatchId(this._matchId);
    this._opts.bridge.send({ command: "set_remote_role", player: this._opts.hostSlot });
    this._opts.bridge.send({ command: "start_game", mode, players, options });
  }
```

In the host `onChannelOpen` (so a late/reconnecting guest re-syncs the id), re-send if present — update the host branch of `start()`:

```ts
      peer.onChannelOpen = () => {
        if (this._matchId) peer.sendData({ t: "matchid", id: this._matchId });
        if (this._lastState) peer.sendData({ t: "state", state: this._lastState });
        sendCard();
      };
```

In `_onPeerMessage`, handle the guest receiving it — add after the `card` branch:

```ts
    if (msg.t === "matchid") {
      this._matchId = msg.id;
      onMatchId(msg.id);
      return;
    }
```

…and destructure `onMatchId` in that method:

```ts
    const { role, bridge, guestSlot, applyState, onOpponentCard, onMatchId } = this._opts;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ui run test -- remoteMatch.matchid`
Expected: PASS. Also run the existing remoteMatch tests: `npm --prefix ui run test -- remoteMatch` — all still green.

- [ ] **Step 5: Commit**

```bash
git add ui/src/multiplayer/remoteMatch.ts ui/src/multiplayer/remoteMatch.matchid.test.ts
git commit -m "feat(ui): share host-minted remote match_id over the data channel"
```

---

## Task 9: `multiplayer/store.ts` — `remoteMatchId`

**Files:**
- Modify: `ui/src/multiplayer/store.ts`
- Test: `ui/src/multiplayer/store.remoteMatch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ui run test -- store.remoteMatch`
Expected: FAIL — `setRemoteMatchId` undefined.

- [ ] **Step 3: Implement**

In `ui/src/multiplayer/store.ts`:

Add to the `MpState` interface (after `brokerUrl: string;`):

```ts
  remoteMatchId: string | null;
```

Add to the actions section of the interface (after `setBrokerUrl`):

```ts
  setRemoteMatchId: (id: string | null) => void;
```

Add to the store initial state (after `brokerUrl: readBrokerUrl(),`):

```ts
  remoteMatchId: null,
```

Add the action (after `setBrokerUrl`):

```ts
  setRemoteMatchId: (id) => set({ remoteMatchId: id }),
```

Add `remoteMatchId: null` to the `resetMp` `set({...})` object:

```ts
  resetMp: () =>
    set({
      mpStatus: "idle",
      room: "",
      selfId: "",
      peers: [],
      error: undefined,
      remoteMatchId: null,
    }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ui run test -- store.remoteMatch`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/multiplayer/store.ts ui/src/multiplayer/store.remoteMatch.test.ts
git commit -m "feat(ui): mp store tracks the active remote match_id"
```

---

## Task 10: `useStatsSubmission` hook (local + remote assembly)

**Files:**
- Create: `ui/src/stats/useStatsSubmission.ts`
- Test: `ui/src/stats/useStatsSubmission.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// ui/src/stats/useStatsSubmission.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useStatsSubmission } from "./useStatsSubmission";
import { useStore } from "../store";
import { useMpStore } from "../multiplayer/store";
import { getOrCreatePlayer, setPlayerName } from "../multiplayer/player";
import * as queue from "./statsQueue";
import type { GameState } from "../types";

function Harness() { useStatsSubmission(); return null; }

const FINISHED = (winner: string, players = ["Ann", "Bob"]): GameState => ({
  mode: "x01", status: "finished", players: players.map((n, i) => ({ id: `id${i}`, name: n })),
  active_index: 0, visit: [], legs: {}, sets: {}, winner, options: {}, mode_view: {},
  stats: { Ann: { darts: 9, total_scored: 180, three_dart_avg: 60 }, Bob: { darts: 9, total_scored: 90, three_dart_avg: 30 } },
});

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
  useMpStore.getState().resetMp();
  setPlayerName("Ann"); // my profile name is "Ann"
});
afterEach(() => vi.restoreAllMocks());

describe("useStatsSubmission", () => {
  it("LOCAL: on finish, fetches export/latest and enqueues my throw-slice", async () => {
    const enq = vi.spyOn(queue, "enqueue").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({
      mode: "x01", players: ["Ann", "Bob"], winner: "Ann",
      started_at: "s", ended_at: "e",
      throws: [{ player: "Ann", bed: "T20", score: 60, ts: "t" }, { player: "Bob", bed: "S5", score: 5, ts: "t" }],
    }) }));
    render(<Harness />);
    useStore.getState().applyEvent({ type: "game_state", state: { ...FINISHED("Ann"), status: "in_progress" } });
    useStore.getState().applyEvent({ type: "game_state", state: FINISHED("Ann") });
    await vi.waitFor(() => expect(enq).toHaveBeenCalled());
    const { record } = enq.mock.calls[0][0];
    expect(record.is_remote).toBe(false);
    expect(record.darts).toBe(1); // only Ann's throw
    expect(record.total_scored).toBe(60);
    expect(record.winner_id).toBe(getOrCreatePlayer().id);
    expect(record.throws).toHaveLength(1);
  });

  it("REMOTE: with an active remote match, enqueues an aggregate from the snapshot", async () => {
    const enq = vi.spyOn(queue, "enqueue").mockImplementation(() => {});
    useMpStore.getState().setRemoteMatchId("shared-1");
    useMpStore.getState().setPeers([{ peer_id: "px", player: { id: "oppId", name: "Bob", avatar: { color: "#0f0" } } }]);
    render(<Harness />);
    useStore.getState().applyEvent({ type: "game_state", state: { ...FINISHED("Ann"), status: "in_progress" } });
    useStore.getState().applyEvent({ type: "game_state", state: FINISHED("Ann") });
    await vi.waitFor(() => expect(enq).toHaveBeenCalled());
    const { record } = enq.mock.calls[0][0];
    expect(record.is_remote).toBe(true);
    expect(record.match_id).toBe("shared-1");
    expect(record.opponent_id).toBe("oppId");
    expect(record.darts).toBe(9);          // Ann's snapshot stats
    expect(record.total_scored).toBe(180);
    expect(record.throws).toBeUndefined(); // aggregate
  });

  it("does nothing when the upload toggle is off", async () => {
    const enq = vi.spyOn(queue, "enqueue").mockImplementation(() => {});
    localStorage.setItem("granbridge.uploadStats", "false");
    render(<Harness />);
    useStore.getState().applyEvent({ type: "game_state", state: { ...FINISHED("Ann"), status: "in_progress" } });
    useStore.getState().applyEvent({ type: "game_state", state: FINISHED("Ann") });
    await Promise.resolve();
    expect(enq).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ui run test -- useStatsSubmission`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `ui/src/stats/useStatsSubmission.ts`:

```ts
import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { useMpStore } from "../multiplayer/store";
import { getOrCreatePlayer } from "../multiplayer/player";
import { getUploadEnabled } from "./uploadPref";
import { enqueue } from "./statsQueue";
import type { GameState } from "../types";
import type { Identity, MatchRecord } from "./types";

/**
 * Watches the game store; when a game transitions to "finished", assembles a
 * MatchRecord and enqueues it for upload (gated by the upload toggle). Two paths:
 * remote (aggregate from the snapshot, shared match_id) vs local (full throws
 * from the app's export/latest, my-slice only).
 */
export function useStatsSubmission(): void {
  const gameState = useStore((s) => s.gameState);
  const prevStatus = useRef<string | null>(null);
  const startedAt = useRef<string | null>(null);

  useEffect(() => {
    const status = gameState?.status ?? null;
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (prev !== "in_progress" && status === "in_progress") {
      startedAt.current = new Date().toISOString();
    }
    if (prev !== "finished" && status === "finished" && gameState) {
      void onFinished(gameState, startedAt.current);
    }
  }, [gameState]);
}

async function onFinished(state: GameState, startedAtIso: string | null): Promise<void> {
  if (!getUploadEnabled()) return;
  const me = getOrCreatePlayer();
  const identity: Identity = { id: me.id, writeToken: me.writeToken, name: me.name, avatarColor: me.avatar.color };
  const mp = useMpStore.getState();

  if (mp.remoteMatchId && mp.peers.length > 0) {
    const opp = mp.peers[0].player;
    const mine = state.stats[me.name] ?? { darts: 0, total_scored: 0 };
    const winner_id = state.winner === me.name ? me.id : state.winner === opp.name ? opp.id : null;
    const record: MatchRecord = {
      match_id: mp.remoteMatchId, mode: state.mode, opponent_id: opp.id, winner_id,
      is_remote: true, darts: mine.darts, total_scored: mine.total_scored,
      started_at: startedAtIso ?? new Date().toISOString(), ended_at: new Date().toISOString(),
    };
    enqueue({ record, identity });
    return;
  }

  // LOCAL: pull the canonical match from the app and take my slice.
  let data: {
    mode: string; players: string[]; winner: string | null; started_at: string; ended_at: string;
    throws: { player: string; bed: string; score: number; ts: string }[];
  };
  try {
    const res = await fetch("/api/history/export/latest");
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return;
  }
  if (!data || !Array.isArray(data.players) || !data.players.includes(me.name)) return; // hotseat skip
  const mine = (data.throws ?? []).filter((t) => t.player === me.name);
  const record: MatchRecord = {
    match_id: crypto.randomUUID(), mode: data.mode, opponent_id: null,
    winner_id: data.winner === me.name ? me.id : null,
    is_remote: false, darts: mine.length, total_scored: mine.reduce((s, t) => s + t.score, 0),
    started_at: data.started_at, ended_at: data.ended_at,
    throws: mine.map((t) => ({ bed: t.bed, score: t.score, ts: t.ts })),
  };
  enqueue({ record, identity });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ui run test -- useStatsSubmission`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add ui/src/stats/useStatsSubmission.ts ui/src/stats/useStatsSubmission.test.tsx
git commit -m "feat(ui): submit-on-game-over hook (local full-throws vs remote aggregate)"
```

---

## Task 11: Wire the hook into the app + Multiplayer

**Files:**
- Modify: `ui/src/App.tsx` (mount hook + flush queue on startup)
- Modify: `ui/src/views/Multiplayer.tsx` (pass `onMatchId` to `RemoteMatch`)
- Test: `ui/src/App.test.tsx` (append or create — assert it renders with the hook mounted)

- [ ] **Step 1: Write the failing test**

```tsx
// ui/src/App.test.tsx  (append; create with these imports if absent)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

// useGranbridgeSocket opens a real WS in jsdom; stub it so App renders headless.
vi.mock("./useGranbridgeSocket", () => ({ useGranbridgeSocket: () => ({ send: vi.fn() }) }));

beforeEach(() => localStorage.clear());

describe("App with stats submission mounted", () => {
  it("renders the nav and does not crash with the stats hook + startup flush", () => {
    render(<App />);
    expect(screen.getByText("GRANBRIDGE")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails (or passes trivially) then drives the change**

Run: `npm --prefix ui run test -- App.test`
Expected: PASS for the render assertion even before wiring — this test is a regression guard that the added hook/flush imports don't break App. Proceed to Step 3 to add them; re-run in Step 4 to confirm still green. (If `App.test.tsx` already exists with other tests, keep them.)

- [ ] **Step 3: Implement**

In `ui/src/App.tsx`, add imports near the top:

```ts
import { useEffect } from "react";
import { useStatsSubmission } from "./stats/useStatsSubmission";
import { flush as flushStatsQueue } from "./stats/statsQueue";
```

(If `useMemo, useState` are imported from "react", change that import to also include `useEffect`: `import { useEffect, useMemo, useState } from "react";` and drop the separate `useEffect` import line to avoid a duplicate.)

Inside `App()`, after the existing `const [activeTab, setActiveTab] = useState<NavTab>("live");` line, add:

```ts
  useStatsSubmission();
  useEffect(() => { void flushStatsQueue(); }, []);
```

In `ui/src/views/Multiplayer.tsx`, in the `RemoteMatch` constructor options (the `new RemoteMatch({ ... })` call), add an `onMatchId` handler alongside `onOpponentCard`:

```ts
      onOpponentCard: (profile, summary) => setOpponentCard({ profile, summary }),
      onMatchId: (id) => useMpStore.getState().setRemoteMatchId(id),
```

- [ ] **Step 4: Run tests to verify**

Run: `npm --prefix ui run test -- App.test` then the full suite `npm --prefix ui run test`
Expected: PASS (all). Then `npm --prefix ui run build` (tsc) — clean.

- [ ] **Step 5: Commit**

```bash
git add ui/src/App.tsx ui/src/views/Multiplayer.tsx ui/src/App.test.tsx
git commit -m "feat(ui): mount stats submission + queue flush; stash remote match_id"
```

---

## Task 12: BUILD-LOG note

**Files:**
- Modify: `docs/BUILD-LOG.md`

- [ ] **Step 1: Append a dated entry**

Summarize Plan 2a: client stats ingestion — `writeToken` identity + recovery codec, `statsClient` (transient-WS `stats_submit` + HTTP reads), offline queue, `uploadPref`, `/api/history/export/latest`, host-minted shared remote `match_id`, and the submit-on-game-over hook (local full-throws vs remote aggregate) mounted app-wide. Note Plan 2b (surfaces) is next. Note remote heatmap is intentionally aggregate-only.

- [ ] **Step 2: Run the full UI + Python suites**

Run: `npm --prefix ui run test` and `python -m pytest tests/test_history_export.py server/tests -q`
Expected: PASS (UI green; Python export + server suites green).

- [ ] **Step 3: Commit**

```bash
git add docs/BUILD-LOG.md
git commit -m "docs: BUILD-LOG for client stats ingestion (Plan 2a)"
```

---

## Self-Review (completed during planning)

**Spec coverage (Plan 2a portion = spec build-order 1–6):** Identity/writeToken + recovery codec → Tasks 1,2. statsClient (submit + reads + brokerHttpBase) → Tasks 3,4. Offline queue → Task 5. Upload toggle helper → Task 6 (UI in 2b). App `export/latest` → Task 7. Submit-on-game-over (local + remote assembly, toggle gate) → Task 10, mounted in Task 11. Remote `match_id` sharing → Tasks 8,9,11. **Deferred to Plan 2b:** Profile recovery UI + server card + toggle *control*, opponent card server fetch, Leaderboard view + nav tab — by design.

**Placeholder scan:** none — every code/test step is complete. The only prose steps are the docs (Task 12) and the App regression-guard rationale (Task 11 Step 2), both concrete.

**Type/name consistency:** `Profile.writeToken` (Task 1) consumed by `Identity` assembly (Task 10) and recovery codec (Task 2). `MatchRecord`/`Identity`/`PlayerSummary`/`LeaderRow`/`QueueEntry` defined in Task 3, used by Tasks 4,5,10. `submitMatch(record, identity, wsUrl?, timeoutMs?)` (Task 4) called by the queue's `Submit` type (Task 5). `enqueue({record, identity})` (Task 5) called by the hook (Task 10). `SyncMsg {t:"matchid",id}` + `onMatchId(id)` (Task 8) → `setRemoteMatchId` (Task 9) → read by the hook's remote path (Task 10) and wired in Task 11. `getUploadEnabled` (Task 6) gates Task 10. `export_latest_match` shape (Task 7: `{mode,players,winner,started_at,ended_at,throws:[{player,bed,score,ts}]}`) matches the hook's local-path parse (Task 10). All consistent.
