# Server-Side Stats — Client Surfaces (Plan 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the stats backend in the UI — Profile shows *server* career stats + recovery-key export/import + the upload toggle, the in-match opponent card prefers the *server* summary (data-channel fallback), and a new Leaderboard view ranks verified players.

**Architecture:** Pure presentation on the Plan-2a ingestion layer. A shared `toCareerSummary` maps the backend `PlayerSummary` → the existing `CareerSummary`. Profile/Multiplayer/Leaderboard read via the already-built `statsClient` (`fetchPlayerSummary`, `fetchLeaderboard`) and the `recoveryKey`/`uploadPref` helpers, all falling back gracefully when the broker is unreachable.

**Tech Stack:** React + TypeScript + Vite + Zustand, vitest + jsdom + @testing-library/react (mock `globalThis.fetch`).

**This is Plan 2b of 2 for the client.** Plan 2a (identity/`statsClient`/queue/`export-latest`/submit-on-game-over) is built on `server-side-stats-client` (PR #3). This plan branches off it (`server-side-stats-client-2b`). Spec: `docs/superpowers/specs/2026-05-24-server-side-stats-client-design.md` (Sections 7–9).

**Commands:** UI tests `npm --prefix ui run test`; typecheck/build `npm --prefix ui run build`. Branch: `server-side-stats-client-2b` (off `server-side-stats-client`).

**Already built in 2a (consumed here):**
- `statsClient.fetchPlayerSummary(id, base?)` → `PlayerSummary` (`{id, display_name, avatar_color, games_played, wins, verified_games, darts, total_scored, three_dart_avg, heatmap}`); `fetchLeaderboard(metric, limit?, base?)` → `{metric, players: LeaderRow[]}` (`LeaderRow` = `{id, display_name, avatar_color, games, wins, three_dart_avg}`); `brokerHttpBase`.
- `recoveryKey.ts`: `exportRecoveryKey({id, writeToken})`, `importRecoveryKey(str)`; `player.ts`: `applyRecoveryKey(str): Profile`, `getOrCreatePlayer()`.
- `uploadPref.ts`: `getUploadEnabled()` / `setUploadEnabled(v)`.
- `careerSummary.ts`: `CareerSummary` = `{threeDartAvg, wins, gamesPlayed}`, `fetchMyCareerSummary(name, base?)`.
- In jsdom, `readBrokerUrl()` returns `ws://127.0.0.1:8788`, so `brokerHttpBase()` → `http://127.0.0.1:8788`; server fetches hit `http://127.0.0.1:8788/stats/...`.

---

## File Structure
- **Modify** `ui/src/stats/statsClient.ts` — add `toCareerSummary(PlayerSummary): CareerSummary` (defensive).
- **Modify** `ui/src/views/Profile.tsx` — server-preferred career card (local fallback) + recovery-key export/import + upload toggle.
- **Modify** `ui/src/views/Profile.test.tsx` — URL-aware fetch mock + tests for the new behavior.
- **Modify** `ui/src/views/Multiplayer.tsx` — opponent card prefers server summary, falls back to the data-channel summary.
- **Modify** `ui/src/views/Multiplayer.test.tsx` — only if needed to keep green.
- **Create** `ui/src/views/Leaderboard.tsx` + `ui/src/views/Leaderboard.test.tsx`.
- **Modify** `ui/src/App.tsx` — add the `"leaderboard"` nav tab + render branch.
- **Modify** `docs/BUILD-LOG.md`, `docs/TARGET-FEATURES.md`.

---

## Task 1: `toCareerSummary` mapper

**Files:**
- Modify: `ui/src/stats/statsClient.ts`
- Test: `ui/src/stats/statsClient.reads.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
// append to ui/src/stats/statsClient.reads.test.ts
import { toCareerSummary } from "./statsClient";

describe("toCareerSummary", () => {
  it("maps a PlayerSummary to a CareerSummary", () => {
    const s = { id: "P1", display_name: "Ann", avatar_color: "#f00", games_played: 5,
      wins: 2, verified_games: 3, darts: 90, total_scored: 1500, three_dart_avg: 50, heatmap: {} };
    expect(toCareerSummary(s)).toEqual({ threeDartAvg: 50, wins: 2, gamesPlayed: 5 });
  });
  it("coerces missing fields to zero", () => {
    expect(toCareerSummary({} as never)).toEqual({ threeDartAvg: 0, wins: 0, gamesPlayed: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ui run test -- statsClient.reads`
Expected: FAIL — `toCareerSummary` not exported.

- [ ] **Step 3: Implement**

Append to `ui/src/stats/statsClient.ts`:

```ts
import type { CareerSummary } from "../multiplayer/careerSummary";

/** Map the broker's PlayerSummary to the UI's CareerSummary (defensive on missing fields). */
export function toCareerSummary(s: PlayerSummary): CareerSummary {
  return {
    threeDartAvg: s?.three_dart_avg ?? 0,
    wins: s?.wins ?? 0,
    gamesPlayed: s?.games_played ?? 0,
  };
}
```

(`PlayerSummary` is already imported in `statsClient.ts` from `./types`. If only used as a type there, ensure the `import type { PlayerSummary, LeaderRow } from "./types";` line covers it — it does.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ui run test -- statsClient.reads`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/stats/statsClient.ts ui/src/stats/statsClient.reads.test.ts
git commit -m "feat(ui): toCareerSummary mapper (PlayerSummary -> CareerSummary)"
```

---

## Task 2: Profile — server-preferred career card (local fallback)

**Files:**
- Modify: `ui/src/views/Profile.tsx`
- Modify: `ui/src/views/Profile.test.tsx`

- [ ] **Step 1: Rewrite the test mock + add server/fallback tests**

Replace the top of `ui/src/views/Profile.test.tsx` (the `mockStats` helper) with a URL-aware mock, and update the existing stats test + add two:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Profile } from "./Profile";

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// URL-aware fetch: /stats/player/* (server) vs /api/history/stats (local fallback).
function mockFetch(opts: { player?: unknown; serverOk?: boolean; localRows?: unknown } = {}) {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/stats/player/")) {
      if (opts.serverOk === false) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(opts.player ?? {}) });
    }
    if (url.includes("/api/history/stats")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(opts.localRows ?? []) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  }) as unknown as typeof globalThis.fetch);
}
```

Keep the existing "renders display-name input", "renders palette", and "updates display name" tests but change their `mockStats([])` calls to `mockFetch()`. Replace the "shows my career stats once loaded" test with:

```tsx
  it("shows my server career stats (across devices) when the broker responds", async () => {
    localStorage.setItem("granbridge.player", JSON.stringify({ id: "id1", name: "Ada", avatar: { color: "#f59e0b" }, writeToken: "t" }));
    mockFetch({ player: { id: "id1", display_name: "Ada", avatar_color: "#f59e0b", games_played: 5, wins: 2, verified_games: 3, darts: 90, total_scored: 1500, three_dart_avg: 55.4, heatmap: {} } });
    render(<Profile />);
    await waitFor(() => expect(screen.getByText("55.4")).toBeInTheDocument());
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText(/across devices/i)).toBeInTheDocument();
  });

  it("falls back to local stats when the broker is unreachable", async () => {
    localStorage.setItem("granbridge.player", JSON.stringify({ id: "id1", name: "Ada", avatar: { color: "#f59e0b" }, writeToken: "t" }));
    mockFetch({ serverOk: false, localRows: [{ player: "Ada", three_dart_avg: 40, wins: 1, games_played: 3 }] });
    render(<Profile />);
    await waitFor(() => expect(screen.getByText("40.0")).toBeInTheDocument());
    expect(screen.getByText(/this device/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix ui run test -- Profile.test`
Expected: FAIL — Profile still uses the local-only summary; "across devices" not present.

- [ ] **Step 3: Implement**

In `ui/src/views/Profile.tsx`, add imports:

```ts
import { fetchPlayerSummary, toCareerSummary } from "../stats/statsClient";
```

Replace the `summary` state + its `useEffect` (lines ~9-16) with a server-preferred fetch that records the source:

```ts
  const [summary, setSummary] = useState<CareerSummary | null>(null);
  const [statsSource, setStatsSource] = useState<"server" | "local">("local");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchPlayerSummary(profile.id);
        if (!cancelled) { setSummary(toCareerSummary(s)); setStatsSource("server"); }
      } catch {
        const local = await fetchMyCareerSummary(profile.name);
        if (!cancelled) { setSummary(local); setStatsSource("local"); }
      }
    })();
    return () => { cancelled = true; };
  }, [profile.id, profile.name]);
```

Replace the career-stats heading + note (the `<h3>` "Career stats (this device)" and the trailing `<p>`):

```tsx
        <h3 className="text-sm text-neutral-300 mb-2">
          Career stats{" "}
          <span className="text-neutral-500">{statsSource === "server" ? "(across devices)" : "(this device)"}</span>
        </h3>
```
and the note paragraph:
```tsx
        <p className="text-neutral-600 text-xs mt-2">
          {statsSource === "server"
            ? "Synced from the stats server, keyed by your player ID."
            : "Server unreachable — showing local stats (keyed by display name)."}
        </p>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix ui run test -- Profile.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/views/Profile.tsx ui/src/views/Profile.test.tsx
git commit -m "feat(ui): Profile prefers server career stats, falls back to local"
```

---

## Task 3: Profile — recovery-key export/import

**Files:**
- Modify: `ui/src/views/Profile.tsx`
- Modify: `ui/src/views/Profile.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// append inside describe("Profile view", ...) in ui/src/views/Profile.test.tsx
  it("exports a recovery key to the clipboard", async () => {
    localStorage.setItem("granbridge.player", JSON.stringify({ id: "id1", name: "Ada", avatar: { color: "#f59e0b" }, writeToken: "tok-1" }));
    mockFetch({ player: { three_dart_avg: 0, wins: 0, games_played: 0 } });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await act(async () => { render(<Profile />); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /export recovery key/i })); });
    const expected = btoa("granbridge:id1:tok-1");
    expect(writeText).toHaveBeenCalledWith(expected);
  });

  it("restores identity from a pasted recovery key", async () => {
    localStorage.setItem("granbridge.player", JSON.stringify({ id: "old", name: "Ada", avatar: { color: "#f59e0b" }, writeToken: "oldtok" }));
    mockFetch({ player: { three_dart_avg: 0, wins: 0, games_played: 0 } });
    await act(async () => { render(<Profile />); });
    const key = btoa("granbridge:restored-id:restored-tok");
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: /recovery key/i }), { target: { value: key } });
      fireEvent.click(screen.getByRole("button", { name: /^restore$/i }));
    });
    expect(JSON.parse(localStorage.getItem("granbridge.player")!).id).toBe("restored-id");
    expect(JSON.parse(localStorage.getItem("granbridge.player")!).writeToken).toBe("restored-tok");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix ui run test -- Profile.test`
Expected: FAIL — no recovery-key controls.

- [ ] **Step 3: Implement**

In `ui/src/views/Profile.tsx`, add imports:

```ts
import { exportRecoveryKey } from "../multiplayer/recoveryKey";
import { applyRecoveryKey } from "../multiplayer/player";
```

Add state near the other `useState`s:

```ts
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
```

Add handlers above the `return`:

```ts
  const exportKey = async () => {
    try {
      await navigator.clipboard?.writeText(exportRecoveryKey(profile));
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 1500);
    } catch { /* ignore */ }
  };
  const restoreKey = () => {
    try {
      setProfile(applyRecoveryKey(keyInput.trim()));
      setKeyError(null);
      setKeyInput("");
    } catch {
      setKeyError("That doesn't look like a valid recovery key.");
    }
  };
```

Add a recovery-key section to the JSX (after the Player ID block, before Career stats):

```tsx
      <div className="border-t border-neutral-800 pt-4">
        <h3 className="text-sm text-neutral-300 mb-1">Recovery key</h3>
        <p className="text-neutral-600 text-xs mb-2">
          Back this up to restore your stats on another device. Restoring replaces this device's identity.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={exportKey} aria-label="Export recovery key" className="text-xs text-amber-300 underline">
            {keyCopied ? "Copied" : "Export recovery key"}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            aria-label="Recovery key"
            placeholder="Paste a recovery key"
            className="flex-1 bg-neutral-800 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <button onClick={restoreKey} aria-label="Restore" className="text-xs text-amber-300 underline">Restore</button>
        </div>
        {keyError && <p role="alert" className="text-red-300 text-xs mt-1">{keyError}</p>}
      </div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix ui run test -- Profile.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/views/Profile.tsx ui/src/views/Profile.test.tsx
git commit -m "feat(ui): Profile recovery-key export/import"
```

---

## Task 4: Profile — upload toggle

**Files:**
- Modify: `ui/src/views/Profile.tsx`
- Modify: `ui/src/views/Profile.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// append inside describe("Profile view", ...)
  it("toggles the upload preference and persists it", async () => {
    mockFetch({ player: { three_dart_avg: 0, wins: 0, games_played: 0 } });
    await act(async () => { render(<Profile />); });
    const toggle = screen.getByRole("checkbox", { name: /upload my stats/i });
    expect((toggle as HTMLInputElement).checked).toBe(true); // default on
    await act(async () => { fireEvent.click(toggle); });
    expect(localStorage.getItem("granbridge.uploadStats")).toBe("false");
    expect((toggle as HTMLInputElement).checked).toBe(false);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix ui run test -- Profile.test`
Expected: FAIL — no upload toggle.

- [ ] **Step 3: Implement**

In `ui/src/views/Profile.tsx`, add import + state:

```ts
import { getUploadEnabled, setUploadEnabled } from "../stats/uploadPref";
```
```ts
  const [upload, setUpload] = useState(() => getUploadEnabled());
```

Add a toggle section to the JSX (e.g. right after the recovery-key block):

```tsx
      <div className="border-t border-neutral-800 pt-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={upload}
            onChange={(e) => { setUploadEnabled(e.target.checked); setUpload(e.target.checked); }}
            aria-label="Upload my stats to the server"
            className="accent-amber-400 w-4 h-4"
          />
          <span className="text-sm text-neutral-300">Upload my stats to the server</span>
        </label>
        <p className="text-neutral-600 text-xs mt-1">When off, finished games stay on this device only.</p>
      </div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix ui run test -- Profile.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/views/Profile.tsx ui/src/views/Profile.test.tsx
git commit -m "feat(ui): Profile upload-stats toggle"
```

---

## Task 5: Multiplayer — opponent card from server (data-channel fallback)

**Files:**
- Modify: `ui/src/views/Multiplayer.tsx`
- Test: `ui/src/views/Multiplayer.test.tsx` (append a focused test)

- [ ] **Step 1: Write the failing test**

```tsx
// append to ui/src/views/Multiplayer.test.tsx (it already renders <Multiplayer/> and mocks media/WebRTC).
// This test drives the onOpponentCard path indirectly is hard; instead unit-test the resolver helper.
import { resolveOpponentSummary } from "./Multiplayer";
import { describe as d2, it as i2, expect as e2, vi as v2, afterEach as a2 } from "vitest";

a2(() => v2.restoreAllMocks());

d2("resolveOpponentSummary", () => {
  i2("prefers the server summary when the fetch succeeds", async () => {
    v2.stubGlobal("fetch", v2.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({
      three_dart_avg: 70, wins: 9, games_played: 12 }) }));
    const out = await resolveOpponentSummary("oppId", { threeDartAvg: 1, wins: 1, gamesPlayed: 1 });
    e2(out).toEqual({ threeDartAvg: 70, wins: 9, gamesPlayed: 12 });
    v2.unstubAllGlobals();
  });
  i2("falls back to the data-channel summary on fetch error", async () => {
    v2.stubGlobal("fetch", v2.fn().mockResolvedValue({ ok: false, status: 500 }));
    const fallback = { threeDartAvg: 1, wins: 1, gamesPlayed: 1 };
    const out = await resolveOpponentSummary("oppId", fallback);
    e2(out).toBe(fallback);
    v2.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix ui run test -- Multiplayer.test`
Expected: FAIL — `resolveOpponentSummary` not exported.

- [ ] **Step 3: Implement**

In `ui/src/views/Multiplayer.tsx`, add imports:

```ts
import { fetchPlayerSummary, toCareerSummary } from "../stats/statsClient";
```

Export a small resolver helper (top-level, above the component):

```ts
/** Prefer the opponent's server career summary; fall back to the data-channel one. */
export async function resolveOpponentSummary(opponentId: string, fallback: CareerSummary): Promise<CareerSummary> {
  try {
    return toCareerSummary(await fetchPlayerSummary(opponentId));
  } catch {
    return fallback;
  }
}
```

Change the `RemoteMatch` `onOpponentCard` wiring (in the `new RemoteMatch({...})` options) to resolve via the server:

```ts
      onOpponentCard: (profile, summary) => {
        void resolveOpponentSummary(profile.id, summary).then((resolved) =>
          setOpponentCard({ profile, summary: resolved }),
        );
      },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix ui run test -- Multiplayer.test`
Expected: PASS. Then full suite `npm --prefix ui run test` stays green.

- [ ] **Step 5: Commit**

```bash
git add ui/src/views/Multiplayer.tsx ui/src/views/Multiplayer.test.tsx
git commit -m "feat(ui): opponent card prefers server stats, falls back to data-channel"
```

---

## Task 6: Leaderboard view

**Files:**
- Create: `ui/src/views/Leaderboard.tsx`, `ui/src/views/Leaderboard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// ui/src/views/Leaderboard.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Leaderboard } from "./Leaderboard";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mockBoard(byMetric: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    const metric = url.includes("metric=wins") ? "wins" : "avg";
    return Promise.resolve({ ok: true, json: () => Promise.resolve(byMetric[metric]) });
  }) as unknown as typeof globalThis.fetch);
}

describe("Leaderboard", () => {
  it("renders ranked players for the default avg metric", async () => {
    mockBoard({ avg: { metric: "avg", players: [
      { id: "p1", display_name: "Ann", avatar_color: "#f00", games: 5, wins: 3, three_dart_avg: 62.5 },
      { id: "p2", display_name: "Bob", avatar_color: "#0f0", games: 4, wins: 1, three_dart_avg: 48 },
    ] } });
    render(<Leaderboard />);
    await waitFor(() => expect(screen.getByText("Ann")).toBeInTheDocument());
    expect(screen.getByText("62.5")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("switches metric and refetches", async () => {
    mockBoard({
      avg: { metric: "avg", players: [{ id: "p1", display_name: "Ann", avatar_color: "#f00", games: 5, wins: 3, three_dart_avg: 62.5 }] },
      wins: { metric: "wins", players: [{ id: "p2", display_name: "Bob", avatar_color: "#0f0", games: 9, wins: 8, three_dart_avg: 40 }] },
    });
    render(<Leaderboard />);
    await waitFor(() => expect(screen.getByText("Ann")).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /wins/i })); });
    await waitFor(() => expect(screen.getByText("Bob")).toBeInTheDocument());
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("shows an empty state when no verified matches", async () => {
    mockBoard({ avg: { metric: "avg", players: [] } });
    render(<Leaderboard />);
    await waitFor(() => expect(screen.getByText(/no verified matches yet/i)).toBeInTheDocument());
  });

  it("shows an error state when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    render(<Leaderboard />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix ui run test -- Leaderboard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `ui/src/views/Leaderboard.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Avatar } from "../components/Avatar";
import { fetchLeaderboard } from "../stats/statsClient";
import { defaultAvatarColor } from "../multiplayer/avatar";
import type { LeaderRow } from "../stats/types";

type Metric = "avg" | "wins";

export function Leaderboard() {
  const [metric, setMetric] = useState<Metric>("avg");
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(false);
    fetchLeaderboard(metric)
      .then((r) => { if (!cancelled) setRows(r.players); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [metric]);

  const tabClass = (active: boolean) =>
    [
      "px-3 py-1.5 rounded-full text-sm font-semibold transition-colors",
      active ? "bg-amber-400 text-neutral-900" : "text-neutral-400 hover:text-white hover:bg-neutral-800",
    ].join(" ");

  return (
    <div className="max-w-2xl mx-auto mt-8 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Leaderboard</h2>
        <div className="flex gap-1" role="group" aria-label="metric">
          <button aria-pressed={metric === "avg"} onClick={() => setMetric("avg")} className={tabClass(metric === "avg")}>
            3-Dart Avg
          </button>
          <button aria-pressed={metric === "wins"} onClick={() => setMetric("wins")} className={tabClass(metric === "wins")}>
            Wins
          </button>
        </div>
      </div>
      <p className="text-neutral-500 text-xs">Only verified (co-signed) matches rank here.</p>

      {error ? (
        <p role="alert" className="text-red-300 text-sm">Couldn't reach the stats server.</p>
      ) : rows === null ? (
        <p className="text-neutral-400 animate-pulse">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-neutral-500 text-sm">No verified matches yet.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center gap-3 bg-neutral-900 rounded-lg px-4 py-2">
              <span className="w-6 text-neutral-500 tabular-nums">{i + 1}</span>
              <Avatar name={r.display_name ?? "?"} color={r.avatar_color ?? defaultAvatarColor(r.id)} size={36} />
              <span className="flex-1 font-semibold">{r.display_name ?? "Anonymous"}</span>
              <span className="text-amber-300 font-bold tabular-nums">
                {metric === "avg" ? r.three_dart_avg.toFixed(1) : r.wins}
              </span>
              <span className="w-16 text-right text-xs text-neutral-500">{r.games}g</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix ui run test -- Leaderboard`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add ui/src/views/Leaderboard.tsx ui/src/views/Leaderboard.test.tsx
git commit -m "feat(ui): Leaderboard view (verified ranking, avg/wins toggle)"
```

---

## Task 7: App.tsx — Leaderboard nav tab

**Files:**
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/App.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// append inside the describe block in ui/src/App.test.tsx
  it("has a Leaderboard nav tab", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /leaderboard/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix ui run test -- App.test`
Expected: FAIL — no Leaderboard button.

- [ ] **Step 3: Implement**

In `ui/src/App.tsx`:

Add the import:
```ts
import { Leaderboard } from "./views/Leaderboard";
```

Extend the `NavTab` union:
```ts
type NavTab = "live" | "history" | "multiplayer" | "profile" | "leaderboard";
```

Add a nav button after the Profile button (mirror the existing button markup):
```tsx
              <button
                onClick={() => setActiveTab("leaderboard")}
                aria-pressed={activeTab === "leaderboard"}
                className={[
                  "px-4 py-1.5 rounded-full text-sm font-semibold transition-colors",
                  activeTab === "leaderboard"
                    ? "bg-amber-400 text-neutral-900"
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800",
                ].join(" ")}
              >
                Leaderboard
              </button>
```

Add a render branch — change the body conditional so leaderboard renders (insert before the `profile` branch):
```tsx
      {activeTab === "leaderboard" ? (
        <Leaderboard />
      ) : activeTab === "profile" ? (
        <Profile />
      ) : activeTab === "multiplayer" ? (
        <Multiplayer />
      ) : activeTab === "history" ? (
        <History />
      ) : playing ? (
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix ui run test -- App.test`
Expected: PASS. Then the FULL UI suite `npm --prefix ui run test` (all green) and `npm --prefix ui run build` (tsc clean).

- [ ] **Step 5: Commit**

```bash
git add ui/src/App.tsx ui/src/App.test.tsx
git commit -m "feat(ui): Leaderboard nav tab"
```

---

## Task 8: Docs

**Files:**
- Modify: `docs/BUILD-LOG.md`, `docs/TARGET-FEATURES.md`

- [ ] **Step 1: Append a BUILD-LOG entry**

Dated entry: client stats **surfaces** (Plan 2b) — Profile shows server career stats (local fallback) + recovery-key export/import + upload toggle; in-match opponent card prefers the server summary (data-channel fallback); new Leaderboard view (verified ranking, avg/wins). Note server-side stats client is now feature-complete (2a ingestion + 2b surfaces).

- [ ] **Step 2: Bump TARGET-FEATURES**

In `docs/TARGET-FEATURES.md`: mark section **D** cross-device career stats + opponent card-from-server as ✅ (client built); mark the **E** Leaderboard as ✅ (built, verified-only).

- [ ] **Step 3: Verify suites**

Run: `npm --prefix ui run test` (all green) and `npm --prefix ui run build` (clean).

- [ ] **Step 4: Commit**

```bash
git add docs/BUILD-LOG.md docs/TARGET-FEATURES.md
git commit -m "docs: BUILD-LOG + TARGET-FEATURES for client stats surfaces (Plan 2b)"
```

---

## Self-Review (completed during planning)

**Spec coverage (client spec §7–9):** §8 Profile recovery UI → Task 3; server career card → Task 2; upload toggle → Task 4. §7 opponent card from server + fallback → Task 5. §9 Leaderboard view + nav tab → Tasks 6,7. Shared mapper → Task 1. Docs → Task 8.

**Placeholder scan:** none — every code/test step is complete; the only prose steps are the docs (Task 8), which enumerate exact content.

**Type/name consistency:** `toCareerSummary(PlayerSummary): CareerSummary` (Task 1) consumed by Profile (Task 2), Multiplayer `resolveOpponentSummary` (Task 5). `CareerSummary` = `{threeDartAvg, wins, gamesPlayed}` used consistently. `LeaderRow` fields (`id, display_name, avatar_color, games, wins, three_dart_avg`) produced by `fetchLeaderboard` (2a) and rendered in Task 6. `fetchPlayerSummary`/`fetchLeaderboard` signatures match 2a. `exportRecoveryKey`/`applyRecoveryKey`/`getUploadEnabled`/`setUploadEnabled` match 2a. The `Profile.test` mock is URL-aware so the server-first fetch + local fallback both resolve deterministically.
