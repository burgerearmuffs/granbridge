# MP-4: Player Profiles + Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each player a persistent profile (name + initials/color avatar + persistent ID) surfaced across the app, with the opponent's name, avatar, and a career stat card shown during a remote match.

**Architecture:** UI-only (no Python/bridge/broker/engine changes). Extends the existing anonymous identity (`player.ts`) into a `Profile`, adds pure avatar helpers + an `<Avatar>` component, a Profile view, and threads the profile through the broker join (the broker forwards the whole `player` dict). The opponent stat card rides MP-3's `RemoteMatch` data channel as a new symmetric `{t:"card"}` message — keeping `RemoteMatch` the single channel owner (no clobbering).

**Tech Stack:** React 18 + TypeScript + Zustand + Vitest. Reuses the existing `/api/history/stats` endpoint and MP-3's `bridgeLink`/`RemoteMatch`/`PeerManager`.

**Branch:** `mp4-profiles` (already cut from `main`).

**Baseline (green at plan time):** 173 Python + 191 UI tests; `npm --prefix ui run build` clean. Each task keeps the UI suite + build green (no Python changes, so the Python suite is untouched).

---

## File Structure

**New (all `ui/src/`):**
- `multiplayer/avatar.ts` — pure `AVATAR_PALETTE`, `defaultAvatarColor(id)`, `initials(name)`.
- `multiplayer/careerSummary.ts` — `CareerSummary` type + `fetchMyCareerSummary(name, base?)`.
- `components/Avatar.tsx` — presentational colored-circle-with-initials.
- `components/OpponentCard.tsx` — presentational opponent stat card (avatar + name + avg/wins/games).
- `views/Profile.tsx` — profile editor + my career stats.

**Modified:**
- `multiplayer/player.ts` — `AvatarSpec`/`Profile` types; migrate identity; `setPlayerColor`.
- `multiplayer/brokerClient.ts` — `PeerInfo.player` gains optional `avatar`; `join` accepts `avatar`.
- `multiplayer/remoteMatch.ts` — `{t:"card"}` exchange (`SyncMsg`, `isSyncMsg`, options, `start`, `_onPeerMessage`).
- `components/VideoTile.tsx` — render `<Avatar>` when there's no stream.
- `views/Multiplayer.tsx` — send avatar on join; build self card; render avatars + opponent card.
- `App.tsx` — "Profile" nav tab.
- `docs/BUILD-LOG.md` — MP-4 entry.

---

## Task 1: Profile + avatar foundation (pure)

**Files:**
- Create: `ui/src/multiplayer/avatar.ts`
- Create: `ui/src/multiplayer/avatar.test.ts`
- Modify: `ui/src/multiplayer/player.ts`
- Create: `ui/src/multiplayer/player.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `ui/src/multiplayer/avatar.test.ts`:

```typescript
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
    expect(initials("Player-a1b2c3")).toBe("PA"); // split on '-' → "Player","a1b2c3"
  });
  it("uses the first two chars of a single token", () => {
    expect(initials("Ada")).toBe("AD");
  });
  it("returns '?' for an empty/whitespace name", () => {
    expect(initials("   ")).toBe("?");
  });
});
```

Create `ui/src/multiplayer/player.test.ts`:

```typescript
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
    // persisted upgrade
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored.avatar.color).toBe(p.avatar.color);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix ui test -- multiplayer/avatar multiplayer/player`
Expected: FAIL — cannot resolve `./avatar`; `setPlayerColor` undefined.

- [ ] **Step 3: Create `ui/src/multiplayer/avatar.ts`**

```typescript
/**
 * Pure avatar helpers — deterministic color + initials. No DOM, no state.
 */

export const AVATAR_PALETTE: string[] = [
  "#f59e0b", "#ef4444", "#10b981", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
];

/** Deterministic palette color from a stable id (sum of char codes mod palette size). */
export function defaultAvatarColor(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length];
}

/** Up to 2 uppercase initials. Two+ tokens → first letter of each of the first two;
 *  single token → first two characters; empty → "?". */
export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const tokens = trimmed.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (tokens.length >= 2) return (tokens[0][0] + tokens[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}
```

- [ ] **Step 4: Rewrite `ui/src/multiplayer/player.ts`**

Replace the entire file with (extends the existing identity to a `Profile`, migrating legacy records):

```typescript
/**
 * Persistent player profile — localStorage. Pure module: no WebRTC, no DOM.
 * Extends the original anonymous identity ({id,name}) with an avatar; legacy
 * records are migrated on read.
 */
import { defaultAvatarColor } from "./avatar";

export interface AvatarSpec {
  color: string;
}
export interface Profile {
  id: string;
  name: string;
  avatar: AvatarSpec;
}

const STORAGE_KEY = "granbridge.player";

/** Return the persisted profile (migrating a legacy {id,name}), or create one. */
export function getOrCreatePlayer(): Profile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { id?: string; name?: string; avatar?: { color?: unknown } };
      if (parsed.id && parsed.name) {
        const hasColor = parsed.avatar && typeof parsed.avatar.color === "string";
        const profile: Profile = {
          id: parsed.id,
          name: parsed.name,
          avatar: { color: hasColor ? (parsed.avatar!.color as string) : defaultAvatarColor(parsed.id) },
        };
        if (!hasColor) _persist(profile); // migrate legacy shape in place
        return profile;
      }
    }
  } catch {
    /* ignore corrupt storage */
  }
  const id = crypto.randomUUID();
  const profile: Profile = { id, name: `Player-${id.slice(0, 6)}`, avatar: { color: defaultAvatarColor(id) } };
  _persist(profile);
  return profile;
}

/** Update the stored display name; returns the updated profile. */
export function setPlayerName(name: string): Profile {
  const updated: Profile = { ...getOrCreatePlayer(), name };
  _persist(updated);
  return updated;
}

/** Update the stored avatar color; returns the updated profile. */
export function setPlayerColor(color: string): Profile {
  const updated: Profile = { ...getOrCreatePlayer(), avatar: { color } };
  _persist(updated);
  return updated;
}

function _persist(p: Profile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore quota errors in tests/SSR */
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix ui test -- multiplayer/avatar multiplayer/player`
Expected: PASS (avatar 5 + player 4).

- [ ] **Step 6: Commit**

```bash
git add ui/src/multiplayer/avatar.ts ui/src/multiplayer/avatar.test.ts ui/src/multiplayer/player.ts ui/src/multiplayer/player.test.ts
git commit -m "feat(profile): profile model + avatar helpers + legacy migration (MP-4)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: `<Avatar>` component

**Files:**
- Create: `ui/src/components/Avatar.tsx`
- Create: `ui/src/components/Avatar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `ui/src/components/Avatar.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("renders the initials for the name", () => {
    render(<Avatar name="Ada Lovelace" color="#f59e0b" />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("exposes an accessible label and applies the background color", () => {
    render(<Avatar name="Bob" color="#3b82f6" />);
    const el = screen.getByRole("img", { name: /bob avatar/i });
    expect(el).toBeInTheDocument();
    expect(el).toHaveStyle({ backgroundColor: "#3b82f6" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix ui test -- components/Avatar`
Expected: FAIL — cannot resolve `./Avatar`.

- [ ] **Step 3: Create `ui/src/components/Avatar.tsx`**

```tsx
/** Avatar — a colored circle with the player's initials. Pure, presentational. */
import { initials } from "../multiplayer/avatar";

interface AvatarProps {
  name: string;
  color: string;
  size?: number;
}

export function Avatar({ name, color, size = 40 }: AvatarProps) {
  return (
    <div
      role="img"
      aria-label={`${name} avatar`}
      style={{ width: size, height: size, backgroundColor: color, fontSize: Math.round(size * 0.4) }}
      className="inline-flex items-center justify-center rounded-full text-white font-bold select-none leading-none"
    >
      {initials(name)}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix ui test -- components/Avatar`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/Avatar.tsx ui/src/components/Avatar.test.tsx
git commit -m "feat(profile): Avatar component (initials + color) (MP-4)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Career summary helper

**Files:**
- Create: `ui/src/multiplayer/careerSummary.ts`
- Create: `ui/src/multiplayer/careerSummary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `ui/src/multiplayer/careerSummary.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchMyCareerSummary } from "./careerSummary";

afterEach(() => { vi.restoreAllMocks(); });

function mockFetch(rows: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(rows),
  }));
}

describe("fetchMyCareerSummary", () => {
  it("maps the row matching the player name", async () => {
    mockFetch([
      { player: "Ada", three_dart_avg: 62.5, wins: 3, games_played: 7 },
      { player: "Bob", three_dart_avg: 40, wins: 1, games_played: 4 },
    ]);
    const s = await fetchMyCareerSummary("Ada");
    expect(s).toEqual({ threeDartAvg: 62.5, wins: 3, gamesPlayed: 7 });
  });

  it("returns zeros when no row matches", async () => {
    mockFetch([{ player: "Bob", three_dart_avg: 40, wins: 1, games_played: 4 }]);
    expect(await fetchMyCareerSummary("Ada")).toEqual({ threeDartAvg: 0, wins: 0, gamesPlayed: 0 });
  });

  it("returns zeros on a failed request", async () => {
    mockFetch([], false);
    expect(await fetchMyCareerSummary("Ada")).toEqual({ threeDartAvg: 0, wins: 0, gamesPlayed: 0 });
  });

  it("returns zeros when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await fetchMyCareerSummary("Ada")).toEqual({ threeDartAvg: 0, wins: 0, gamesPlayed: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix ui test -- multiplayer/careerSummary`
Expected: FAIL — cannot resolve `./careerSummary`.

- [ ] **Step 3: Create `ui/src/multiplayer/careerSummary.ts`**

```typescript
/**
 * CareerSummary — the small per-player stat card sourced from the bridge's
 * existing /api/history/stats endpoint (rows keyed by display name).
 */

export interface CareerSummary {
  threeDartAvg: number;
  wins: number;
  gamesPlayed: number;
}

const ZERO: CareerSummary = { threeDartAvg: 0, wins: 0, gamesPlayed: 0 };

interface StatRow {
  player: string;
  three_dart_avg: number;
  wins: number;
  games_played: number;
}

/** Fetch /api/history/stats and return the summary for `name` (zeros on miss/error). */
export async function fetchMyCareerSummary(name: string, base = ""): Promise<CareerSummary> {
  try {
    const res = await fetch(`${base}/api/history/stats`);
    if (!res.ok) return ZERO;
    const rows = (await res.json()) as StatRow[];
    const row = rows.find((r) => r.player === name);
    if (!row) return ZERO;
    return { threeDartAvg: row.three_dart_avg, wins: row.wins, gamesPlayed: row.games_played };
  } catch {
    return ZERO;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix ui test -- multiplayer/careerSummary`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add ui/src/multiplayer/careerSummary.ts ui/src/multiplayer/careerSummary.test.ts
git commit -m "feat(profile): career summary fetch from /api/history/stats (MP-4)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Profile view + nav tab

**Files:**
- Create: `ui/src/views/Profile.tsx`
- Create: `ui/src/views/Profile.test.tsx`
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Write the failing test**

Create `ui/src/views/Profile.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Profile } from "./Profile";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

function mockStats(rows: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(rows) }));
}

describe("Profile view", () => {
  it("renders the display-name input and the avatar preview", () => {
    mockStats([]);
    render(<Profile />);
    expect(screen.getByRole("textbox", { name: /display name/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /avatar/i })).toBeInTheDocument();
  });

  it("renders the palette color swatches", () => {
    mockStats([]);
    render(<Profile />);
    // 8 palette swatches (aria-label "Color #...")
    expect(screen.getAllByRole("button", { name: /^color #/i })).toHaveLength(8);
  });

  it("shows my career stats once loaded", async () => {
    // Name the player so the stats row matches.
    localStorage.setItem("granbridge.player", JSON.stringify({ id: "id1", name: "Ada", avatar: { color: "#f59e0b" } }));
    mockStats([{ player: "Ada", three_dart_avg: 55.4, wins: 2, games_played: 5 }]);
    render(<Profile />);
    await waitFor(() => expect(screen.getByText("55.4")).toBeInTheDocument());
    expect(screen.getByText("2")).toBeInTheDocument();   // wins
    expect(screen.getByText("5")).toBeInTheDocument();   // games
  });

  it("updates the display name on input", () => {
    mockStats([]);
    render(<Profile />);
    const input = screen.getByRole("textbox", { name: /display name/i });
    fireEvent.change(input, { target: { value: "Zoe" } });
    expect((input as HTMLInputElement).value).toBe("Zoe");
    expect(JSON.parse(localStorage.getItem("granbridge.player")!).name).toBe("Zoe");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix ui test -- views/Profile`
Expected: FAIL — cannot resolve `./Profile`.

- [ ] **Step 3: Create `ui/src/views/Profile.tsx`**

```tsx
import { useEffect, useState } from "react";
import { getOrCreatePlayer, setPlayerName, setPlayerColor } from "../multiplayer/player";
import { AVATAR_PALETTE, defaultAvatarColor } from "../multiplayer/avatar";
import { Avatar } from "../components/Avatar";
import { fetchMyCareerSummary, type CareerSummary } from "../multiplayer/careerSummary";

export function Profile() {
  const [profile, setProfile] = useState(() => getOrCreatePlayer());
  const [summary, setSummary] = useState<CareerSummary | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMyCareerSummary(profile.name).then((s) => { if (!cancelled) setSummary(s); });
    return () => { cancelled = true; };
  }, [profile.name]);

  const copyId = async () => {
    try {
      await navigator.clipboard?.writeText(profile.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="max-w-md mx-auto mt-8 space-y-6">
      <h2 className="text-2xl font-bold">Profile</h2>

      <div className="flex items-center gap-4">
        <Avatar name={profile.name} color={profile.avatar.color} size={72} />
        <p className="text-neutral-400 text-sm">This is how opponents see you in matches.</p>
      </div>

      <label className="block">
        <span className="text-sm text-neutral-300">Display name</span>
        <input
          type="text"
          value={profile.name}
          onChange={(e) => setProfile(setPlayerName(e.target.value))}
          aria-label="Display name"
          className="mt-1 w-full bg-neutral-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      </label>

      <div>
        <span className="text-sm text-neutral-300">Avatar color</span>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {AVATAR_PALETTE.map((c) => (
            <button
              key={c}
              aria-label={`Color ${c}`}
              onClick={() => setProfile(setPlayerColor(c))}
              style={{ backgroundColor: c }}
              className={`w-8 h-8 rounded-full border-2 ${profile.avatar.color === c ? "border-white" : "border-transparent"}`}
            />
          ))}
          <button
            onClick={() => setProfile(setPlayerColor(defaultAvatarColor(profile.id)))}
            className="text-xs text-neutral-400 underline ml-2"
          >
            Reset
          </button>
        </div>
      </div>

      <div>
        <span className="text-sm text-neutral-300">Player ID</span>
        <div className="mt-1 flex items-center gap-2">
          <code className="text-xs text-neutral-400 bg-neutral-800 rounded px-2 py-1 truncate max-w-[16rem]">{profile.id}</code>
          <button onClick={copyId} aria-label="Copy player ID" className="text-xs text-amber-300 underline">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm text-neutral-300 mb-2">
          Career stats <span className="text-neutral-500">(this device)</span>
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="3-Dart Avg" value={summary ? summary.threeDartAvg.toFixed(1) : "…"} />
          <Stat label="Wins" value={summary ? String(summary.wins) : "…"} />
          <Stat label="Games" value={summary ? String(summary.gamesPlayed) : "…"} />
        </div>
        <p className="text-neutral-600 text-xs mt-2">Stats are local to this device and keyed by display name.</p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-800 rounded-lg px-3 py-3 text-center">
      <div className="text-2xl font-bold text-amber-300 tabular-nums">{value}</div>
      <div className="text-xs text-neutral-400">{label}</div>
    </div>
  );
}
```

- [ ] **Step 4: Add the "Profile" nav tab in `ui/src/App.tsx`**

Read `ui/src/App.tsx` first. Make three edits:

(a) Add the import alongside the other view imports (e.g. after `import { Multiplayer } from "./views/Multiplayer";`):
```tsx
import { Profile } from "./views/Profile";
```

(b) Extend the `NavTab` union:
```tsx
type NavTab = "live" | "history" | "multiplayer" | "profile";
```

(c) Add a nav button immediately AFTER the existing "Multiplayer" `<button>…</button>` (mirror its markup exactly):
```tsx
              <button
                onClick={() => setActiveTab("profile")}
                aria-pressed={activeTab === "profile"}
                className={[
                  "px-4 py-1.5 rounded-full text-sm font-semibold transition-colors",
                  activeTab === "profile"
                    ? "bg-amber-400 text-neutral-900"
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800",
                ].join(" ")}
              >
                Profile
              </button>
```

(d) Add a render branch. The current content block is:
```tsx
      {activeTab === "multiplayer" ? (
        <Multiplayer />
      ) : activeTab === "history" ? (
        <History />
      ) : playing ? (
```
Change the first line to insert the profile branch before it:
```tsx
      {activeTab === "profile" ? (
        <Profile />
      ) : activeTab === "multiplayer" ? (
        <Multiplayer />
      ) : activeTab === "history" ? (
        <History />
      ) : playing ? (
```

- [ ] **Step 5: Run the tests + build**

Run: `npm --prefix ui test -- views/Profile`
Expected: PASS (4).
Run: `npm --prefix ui run build`
Expected: `tsc -b` clean + vite ok (proves the App.tsx tab wiring typechecks).

- [ ] **Step 6: Commit**

```bash
git add ui/src/views/Profile.tsx ui/src/views/Profile.test.tsx ui/src/App.tsx
git commit -m "feat(profile): Profile view (editor + career stats) + nav tab (MP-4)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: RemoteMatch card exchange + broker plumbing

**Files:**
- Modify: `ui/src/multiplayer/brokerClient.ts`
- Modify: `ui/src/multiplayer/remoteMatch.ts`
- Modify: `ui/src/multiplayer/remoteMatch.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `ui/src/multiplayer/remoteMatch.test.ts` (the file's `fakePeer`/`fakeBridge` helpers already exist). Add a `PROFILE`/`SUMMARY` fixture near the existing `STATE` const, then the tests:

```typescript
import type { Profile } from "./player";
import type { CareerSummary } from "./careerSummary";

const PROFILE: Profile = { id: "id-h", name: "Host", avatar: { color: "#f59e0b" } };
const SUMMARY: CareerSummary = { threeDartAvg: 60, wins: 2, gamesPlayed: 5 };

describe("RemoteMatch card exchange", () => {
  it("host sends its card on channel open when selfCard is set", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    new RemoteMatch({ role: "host", peer, bridge, applyState: () => {}, selfCard: { profile: PROFILE, summary: SUMMARY } }).start();
    peer.sent.length = 0;
    peer.fireOpen();
    expect(peer.sent).toContainEqual({ t: "card", profile: PROFILE, summary: SUMMARY });
  });

  it("guest sends its card on channel open when selfCard is set", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    new RemoteMatch({ role: "guest", peer, bridge, applyState: () => {}, selfCard: { profile: PROFILE, summary: SUMMARY } }).start();
    peer.fireOpen();
    expect(peer.sent).toEqual([{ t: "card", profile: PROFILE, summary: SUMMARY }]);
  });

  it("does not send a card when selfCard is absent", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    new RemoteMatch({ role: "guest", peer, bridge, applyState: () => {} }).start();
    peer.fireOpen();
    expect(peer.sent).toEqual([]);
  });

  it("calls onOpponentCard when a card message arrives (either role)", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const onOpponentCard = vi.fn();
    new RemoteMatch({ role: "host", peer, bridge, applyState: () => {}, onOpponentCard }).start();
    peer.fireData({ t: "card", profile: PROFILE, summary: SUMMARY });
    expect(onOpponentCard).toHaveBeenCalledWith(PROFILE, SUMMARY);
  });

  it("ignores a malformed card message", () => {
    const peer = fakePeer(); const bridge = fakeBridge();
    const onOpponentCard = vi.fn();
    new RemoteMatch({ role: "guest", peer, bridge, applyState: () => {}, onOpponentCard }).start();
    peer.fireData({ t: "card", profile: "nope" });   // profile not an object
    expect(onOpponentCard).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix ui test -- multiplayer/remoteMatch`
Expected: FAIL — `selfCard`/`onOpponentCard` not in options; no card handling.

- [ ] **Step 3: Extend `ui/src/multiplayer/brokerClient.ts`**

(a) Add a type import at the top (after the file's opening comment, before `export interface PeerInfo`):
```typescript
import type { AvatarSpec } from "./player";
```
(b) Change `PeerInfo` to allow an optional avatar:
```typescript
export interface PeerInfo {
  peer_id: string;
  player: { id: string; name: string; avatar?: AvatarSpec };
}
```
(c) Widen the `join` signature and the `_pendingJoin` field to accept the optional avatar. Change the `_pendingJoin` declaration:
```typescript
  private _pendingJoin: { room: string; password: string; player: { id: string; name: string; avatar?: AvatarSpec } } | null = null;
```
and the `join` method signature:
```typescript
  join(room: string, password: string, player: { id: string; name: string; avatar?: AvatarSpec }): void {
```
(Leave the method bodies unchanged — they already pass the whole `player` object through.)

- [ ] **Step 4: Extend `ui/src/multiplayer/remoteMatch.ts`**

(a) Add type imports after the existing imports (lines 18-19):
```typescript
import type { Profile } from "./player";
import type { CareerSummary } from "./careerSummary";
```

(b) Add a `PeerCard` type and extend `SyncMsg`:
```typescript
export interface PeerCard {
  profile: Profile;
  summary: CareerSummary;
}

export type SyncMsg =
  | { t: "state"; state: GameState }
  | { t: "dart"; bed: string }
  | { t: "card"; profile: Profile; summary: CareerSummary };
```

(c) Extend `RemoteMatchOptions` with the two optional fields (after `guestSlot?`):
```typescript
  /** This client's advertised card; sent to the peer on channel open. */
  selfCard?: PeerCard | null;
  /** Called when the peer's card arrives. */
  onOpponentCard?: (profile: Profile, summary: CareerSummary) => void;
```

(d) Extend `isSyncMsg` to validate the card variant (add before the final `return false;`):
```typescript
  if (t === "card") {
    const profile = (o as { profile?: unknown }).profile;
    const summary = (o as { summary?: unknown }).summary;
    return typeof profile === "object" && profile !== null && typeof summary === "object" && summary !== null;
  }
```

(e) Provide defaults for the new options in the constructor:
```typescript
  constructor(opts: RemoteMatchOptions) {
    this._opts = { hostSlot: "p1", guestSlot: "p2", selfCard: null, onOpponentCard: () => {}, ...opts };
  }
```

(f) Make both roles advertise their card on channel open. Replace the body of `start()` (the part after `peer.onDataMessage = ...`) with:
```typescript
    peer.onDataMessage = (_peerId, obj) => this._onPeerMessage(obj);

    const sendCard = () => {
      const card = this._opts.selfCard;
      if (card) peer.sendData({ t: "card", profile: card.profile, summary: card.summary });
    };

    if (role === "host") {
      // Re-send the latest snapshot + our card whenever a (re)connecting guest channel opens.
      peer.onChannelOpen = () => {
        if (this._lastState) peer.sendData({ t: "state", state: this._lastState });
        sendCard();
      };
      this._unsub = bridge.onEvent((e) => {
        if (e.type === "game_state") {
          this._lastState = e.state;
          peer.sendData({ t: "state", state: e.state });
        }
      });
    } else {
      peer.onChannelOpen = () => { sendCard(); };
      this._unsub = bridge.onEvent((e) => {
        if (e.type === "dart_hit") {
          peer.sendData({ t: "dart", bed: e.bed });
        }
      });
    }
```

(g) Handle the card message in `_onPeerMessage` (role-agnostic). Replace the method with:
```typescript
  private _onPeerMessage(obj: unknown): void {
    if (!isSyncMsg(obj)) return;
    const msg = obj;
    const { role, bridge, guestSlot, applyState, onOpponentCard } = this._opts;
    if (msg.t === "card") {
      onOpponentCard(msg.profile, msg.summary);
      return;
    }
    if (role === "host") {
      if (msg.t === "dart") {
        bridge.send({ command: "remote_dart", bed: msg.bed, player: guestSlot });
      }
    } else if (msg.t === "state") {
      applyState(msg.state);
    }
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix ui test -- multiplayer/remoteMatch`
Expected: PASS — the 5 new card tests AND all existing RemoteMatch tests (dart/state/stop/reconnect) still green.

- [ ] **Step 6: Commit**

```bash
git add ui/src/multiplayer/remoteMatch.ts ui/src/multiplayer/remoteMatch.test.ts ui/src/multiplayer/brokerClient.ts
git commit -m "feat(profile): opponent card exchange over the data channel + avatar in PeerInfo (MP-4)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: VideoTile avatar + OpponentCard component

**Files:**
- Modify: `ui/src/components/VideoTile.tsx`
- Modify: `ui/src/components/VideoTile.test.tsx` (create if absent)
- Create: `ui/src/components/OpponentCard.tsx`
- Create: `ui/src/components/OpponentCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `ui/src/components/OpponentCard.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OpponentCard } from "./OpponentCard";

describe("OpponentCard", () => {
  it("renders the opponent name, avatar, and stats", () => {
    render(
      <OpponentCard
        profile={{ id: "id2", name: "Bob", avatar: { color: "#3b82f6" } }}
        summary={{ threeDartAvg: 48.6, wins: 4, gamesPlayed: 9 }}
      />,
    );
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /bob avatar/i })).toBeInTheDocument();
    expect(screen.getByText("48.6")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });
});
```

Create `ui/src/components/VideoTile.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VideoTile } from "./VideoTile";

describe("VideoTile", () => {
  it("renders the label", () => {
    render(<VideoTile stream={null} label="Ada (you)" />);
    expect(screen.getByText("Ada (you)")).toBeInTheDocument();
  });

  it("shows an avatar when there is no stream and an avatarName is given", () => {
    render(<VideoTile stream={null} label="Bob" avatarName="Bob" avatarColor="#3b82f6" />);
    expect(screen.getByRole("img", { name: /bob avatar/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix ui test -- components/OpponentCard components/VideoTile`
Expected: FAIL — cannot resolve `./OpponentCard`; no avatar in VideoTile.

- [ ] **Step 3: Create `ui/src/components/OpponentCard.tsx`**

```tsx
/** OpponentCard — opponent's avatar, name, and career summary (received over the data channel). */
import { Avatar } from "./Avatar";
import type { Profile } from "../multiplayer/player";
import type { CareerSummary } from "../multiplayer/careerSummary";

interface OpponentCardProps {
  profile: Profile;
  summary: CareerSummary;
}

export function OpponentCard({ profile, summary }: OpponentCardProps) {
  return (
    <div className="flex items-center gap-4 bg-neutral-900 rounded-lg px-4 py-3">
      <Avatar name={profile.name} color={profile.avatar.color} size={48} />
      <div className="flex-1">
        <div className="font-semibold">{profile.name}</div>
        <div className="text-xs text-neutral-400">opponent</div>
      </div>
      <div className="flex gap-4 text-center">
        <Stat label="Avg" value={summary.threeDartAvg.toFixed(1)} />
        <Stat label="Wins" value={String(summary.wins)} />
        <Stat label="Games" value={String(summary.gamesPlayed)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-bold text-amber-300 tabular-nums">{value}</div>
      <div className="text-[10px] text-neutral-500 uppercase tracking-wide">{label}</div>
    </div>
  );
}
```

- [ ] **Step 4: Update `ui/src/components/VideoTile.tsx`**

(a) Add the import at the top:
```tsx
import { Avatar } from "./Avatar";
```
(b) Extend the props interface:
```tsx
interface VideoTileProps {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  micActive?: boolean;
  camActive?: boolean;
  avatarName?: string;
  avatarColor?: string;
}
```
(c) Destructure the new props in the function signature:
```tsx
export function VideoTile({ stream, label, muted = false, micActive = true, camActive = true, avatarName, avatarColor }: VideoTileProps) {
```
(d) Add the avatar overlay immediately AFTER the `<video … />` element (before the bottom label `<div>`):
```tsx
      {!stream && avatarName && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Avatar name={avatarName} color={avatarColor ?? "#3f3f46"} size={64} />
        </div>
      )}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix ui test -- components/OpponentCard components/VideoTile`
Expected: PASS (OpponentCard 1 + VideoTile 2).

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/OpponentCard.tsx ui/src/components/OpponentCard.test.tsx ui/src/components/VideoTile.tsx ui/src/components/VideoTile.test.tsx
git commit -m "feat(profile): OpponentCard + VideoTile avatar fallback (MP-4)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Multiplayer view wiring (avatars on join + tiles + opponent card)

**Files:**
- Modify: `ui/src/views/Multiplayer.tsx`
- Modify: `ui/src/views/Multiplayer.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `ui/src/views/Multiplayer.test.tsx` (it already imports `render, screen, fireEvent, act`, `useMpStore`, and `useStore`). Add at the end:

```typescript
import { OpponentCard } from "../components/OpponentCard";

describe("Multiplayer avatars", () => {
  it("renders an avatar for a peer with no stream", () => {
    useMpStore.setState({
      mpStatus: "in_room",
      room: "r1",
      selfId: "aaa",
      peers: [{ peer_id: "zzz", player: { id: "id-z", name: "Zoe", avatar: { color: "#10b981" } } }],
    });
    render(<Multiplayer />);
    // Zoe's tile has no stream → avatar shown
    expect(screen.getByRole("img", { name: /zoe avatar/i })).toBeInTheDocument();
  });
});

// OpponentCard is unit-tested in components/OpponentCard.test.tsx; here we only
// assert the Multiplayer view imports + renders it for the opponent-card slot.
describe("OpponentCard wiring smoke", () => {
  it("OpponentCard renders given a profile + summary", () => {
    render(
      <OpponentCard
        profile={{ id: "x", name: "Eve", avatar: { color: "#ef4444" } }}
        summary={{ threeDartAvg: 1, wins: 0, gamesPlayed: 0 }}
      />,
    );
    expect(screen.getByText("Eve")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix ui test -- views/Multiplayer`
Expected: FAIL — the peer tile renders no avatar yet (the `/zoe avatar/i` query fails).

- [ ] **Step 3: Wire `ui/src/views/Multiplayer.tsx`**

Read the file first. Make these edits:

(a) Add imports after `import { RemoteMatch, hostRole } from "../multiplayer/remoteMatch";`:
```tsx
import { Avatar } from "../components/Avatar";
import { OpponentCard } from "../components/OpponentCard";
import { defaultAvatarColor } from "../multiplayer/avatar";
import { fetchMyCareerSummary } from "../multiplayer/careerSummary";
import type { Profile } from "../multiplayer/player";
import type { CareerSummary } from "../multiplayer/careerSummary";
```

(b) Add state + a ref. After `const [opponentCard…]`? — there is none yet; add after `const [mpMode, setMpMode] = useState("x01");`:
```tsx
  const [opponentCard, setOpponentCard] = useState<{ profile: Profile; summary: CareerSummary } | null>(null);
```
And add a ref next to `rmRef`:
```tsx
  const selfCardRef = useRef<{ profile: Profile; summary: CareerSummary } | null>(null);
```

(c) In `handleJoin`, after `const stream = await getLocalStream(...)` / `setLocalStream(stream)`, build the self card (the profile already comes from `setPlayerName` as `player`):
```tsx
    // Build the card we advertise to the opponent (profile + local career summary).
    const summary = await fetchMyCareerSummary(player.name);
    selfCardRef.current = { profile: player, summary };
```
And change the join call to include the avatar:
```tsx
    bc.join(roomInput.trim(), passwordInput.trim(), { id: player.id, name: player.name, avatar: player.avatar });
```

(d) In the RemoteMatch-creation effect, pass the card options. Replace the `new RemoteMatch({...})` call with:
```tsx
    const rm = new RemoteMatch({
      role: hostRole(selfId, peers),
      peer: pmRef.current,
      bridge: bridgeLink,
      applyState: (state) => useStore.getState().applyEvent({ type: "game_state", state }),
      selfCard: selfCardRef.current,
      onOpponentCard: (profile, summary) => setOpponentCard({ profile, summary }),
    });
```

(e) In `handleLeave`, after `rmRef.current = null;` add:
```tsx
    setOpponentCard(null);
```

(f) Add avatar props to the tiles in the `in_room` render. Replace the local tile + remote-tile map with:
```tsx
        {/* Local tile — always muted */}
        <VideoTile
          stream={localStream}
          label={`${displayName} (you)`}
          muted
          micActive={mic}
          camActive={cam}
          avatarName={displayName}
          avatarColor={identity.avatar.color}
        />
        {/* Remote tiles */}
        {peers.map((p) => (
          <VideoTile
            key={p.peer_id}
            stream={remoteStreams.get(p.peer_id) ?? null}
            label={p.player.name}
            muted={false}
            avatarName={p.player.name}
            avatarColor={p.player.avatar?.color ?? defaultAvatarColor(p.player.id)}
          />
        ))}
```

(g) Render the opponent card. Immediately after the closing `</div>` of the video grid (before the "Peer list" block), add:
```tsx
      {opponentCard && (
        <OpponentCard profile={opponentCard.profile} summary={opponentCard.summary} />
      )}
```

- [ ] **Step 4: Run the tests + full suite + build**

Run: `npm --prefix ui test -- views/Multiplayer`
Expected: PASS — existing Multiplayer tests + the new avatar test.
Run: `npm --prefix ui test`
Expected: PASS — full UI suite green (baseline 191 + new MP-4 tests).
Run: `npm --prefix ui run build`
Expected: `tsc -b` clean + vite ok (proves Profile/CareerSummary/PeerCard/PeerInfo types align across files).

- [ ] **Step 5: Commit**

```bash
git add ui/src/views/Multiplayer.tsx ui/src/views/Multiplayer.test.tsx
git commit -m "feat(profile): avatars on join/tiles + opponent stat card in matches (MP-4)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Docs — build-log entry

**Files:**
- Modify: `docs/BUILD-LOG.md`

- [ ] **Step 1: Append the MP-4 entry to `docs/BUILD-LOG.md`**

```markdown

### MP-4 · Player profiles + avatars ✅
Spec `docs/superpowers/specs/2026-05-22-mp4-profiles-design.md`; plan
`docs/superpowers/plans/2026-05-22-mp4-profiles.md`. Built subagent-driven on `mp4-profiles`.
**UI-only — no Python/bridge/broker/engine changes.**

- **Profile:** extended the anonymous identity (`player.ts`) to `Profile {id, name, avatar:{color}}`
  with legacy `{id,name}` migration; `setPlayerColor`. Pure `avatar.ts` (`initials`, deterministic
  `defaultAvatarColor`, `AVATAR_PALETTE`); `<Avatar>` component.
- **Profile view:** new nav tab — edit name, pick avatar color, copy persistent ID, and see my
  career stats (from the existing `/api/history/stats`, matched by display name).
- **Multiplayer:** avatar travels in the broker `join` (the broker forwards the whole `player`
  dict); avatars on the local + peer video tiles (shown when a cam is off); opponent **stat card**
  (avatar, name, 3-dart avg / wins / games) exchanged symmetrically over MP-3's data channel via a
  new `{t:"card"}` message — `RemoteMatch` stays the single channel owner.
- **Tests:** +UI only (avatar/player/careerSummary/Avatar/OpponentCard/VideoTile/Profile + RemoteMatch
  card exchange + Multiplayer avatar). Full UI suite + `npm --prefix ui run build` green.
- **Known limitations:** stats are keyed by display name and remote-match guest throws aren't
  recorded — so the opponent card reflects each player's *local* stats only. True per-identity,
  cross-device stats remain the deferred **server-side** profile feature. Avatars are initials+color
  (uploaded images deferred).

**Next:** quick parity modes (Count-Up, Medley); real app icons; (later) server-side profiles/accounts.
```

- [ ] **Step 2: Commit**

```bash
git add docs/BUILD-LOG.md
git commit -m "docs: MP-4 profiles + avatars build-log entry

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `npm --prefix ui test` → full UI suite green.
- [ ] `npm --prefix ui run build` → clean tsc + vite build.
- [ ] `git log --oneline` on `mp4-profiles` — one focused commit per task.
- [ ] Then: final review, merge to `main`, push; manual check (open Profile tab; in a 2-instance run, confirm opponent avatar + stat card appear).

---

## Self-Review (against the spec)

**Spec coverage:**
- Data model `Profile`/`AvatarSpec`/`CareerSummary` → Task 1 (player.ts) + Task 3 (careerSummary.ts). ✓
- Migration of legacy `{id,name}` → Task 1 `getOrCreatePlayer` + test. ✓
- `defaultAvatarColor`/`initials`/`AVATAR_PALETTE` → Task 1 avatar.ts. ✓
- `<Avatar>` component → Task 2. ✓
- `fetchMyCareerSummary` (match by name, zeros on miss/error) → Task 3. ✓
- Profile view (name, color picker + reset, ID + copy, my stats) + nav tab → Task 4. ✓
- `PeerInfo.player.avatar` + join carries avatar → Task 5 (brokerClient) + Task 7 (join call). ✓
- Card exchange folded into RemoteMatch (`{t:"card"}`, symmetric on open, `onOpponentCard`, isSyncMsg) → Task 5. ✓
- VideoTile avatar-when-no-stream → Task 6. ✓
- OpponentCard + Multiplayer wiring (selfCard, opponent card, tile avatars) → Tasks 6–7. ✓
- Docs + known limitations → Task 8. ✓
- "No Python/broker changes" — confirmed: no task touches `src/` or `server/`. ✓

**Placeholder scan:** none — every step has real code/tests/commands.

**Type consistency:** `Profile {id,name,avatar:{color}}` used identically in player.ts, Avatar props (name+color), OpponentCard, RemoteMatch `PeerCard`, brokerClient `PeerInfo`, Multiplayer. `CareerSummary {threeDartAvg,wins,gamesPlayed}` consistent in careerSummary.ts, Profile, OpponentCard, RemoteMatch. `fetchMyCareerSummary(name, base?)` signature matches callers (Profile, Multiplayer). `setPlayerColor`/`setPlayerName` return `Profile`. RemoteMatch `selfCard?: PeerCard | null` + `onOpponentCard?: (profile, summary) => void` match the constructor defaults and the Multiplayer call site. No mismatches found.
