# Server-Side Stats — Client Integration Design (Plan 2)

> Plan 2 of 2 for server-side stats. The backend (Plan 1) is built on branch `server-side-stats`
> (PR #2): `StatsStore` + broker `stats_submit` (WS write) + `GET /stats/player/{id}` /
> `/stats/leaderboard` (HTTP reads), TOFU write-token auth, co-signed verification, verified-only
> leaderboard. This plan wires the **web UI** (and one small app endpoint) to that backend.
> Brainstormed 2026-05-24. Branch: `server-side-stats-client` (off `server-side-stats`).
> Backend spec: `docs/superpowers/specs/2026-05-24-server-side-stats-design.md`.

## Goal
Make the desktop app actually use the stats backend: persist a player's stats server-side keyed by a
durable **recovery-key identity**, submit finished matches (with an offline queue + a user toggle),
show the opponent's **server** career card in remote matches, surface **my** server career stats, and
add a **Leaderboard** view.

## Locked decisions (via brainstorming)
1. **Remote fidelity = aggregate.** Remote matches contribute avg/wins/games + verification, assembled
   from the `game_state` snapshot on **both** sides (symmetric, no server-side guest recording). The
   per-segment **heatmap reflects local/solo play only** (which has full per-throw data via the app).
2. **Submission mechanism = a dedicated `statsClient` with a transient WebSocket** (open →
   `stats_submit` → await `stats_ack` → close), not an extension of `BrokerClient`. Reads are HTTP GET
   to the broker host.
3. **Remote `match_id` = host-minted, shared over the data channel** (not a clock-dependent hash).
4. **Upload toggle lives in the Profile view** (`granbridge.uploadStats`, default on), following the
   `VideoToggle` localStorage pattern. No new Settings view (YAGNI).

## Non-goals (deferred)
- Per-segment heatmap for remote matches (would need client-side dart accumulation with bust/undo
  handling — deferred).
- A general settings view; image avatars; spectator/leaderboard pagination; cross-device merge of
  pre-existing name-keyed local history (server stats start fresh per identity).

## Key UI facts this design is built on (from exploration)
- `player.ts`: `Profile = {id, name, avatar:{color}}`, key `granbridge.player`, with an existing
  migration pattern (added `avatar.color`). 
- `brokerClient.ts`: no singleton; room-shaped API; URL via `readBrokerUrl()` in `multiplayer/store.ts`
  (localStorage `granbridge.mp.brokerUrl` > `VITE_BROKER_URL` > `ws://127.0.0.1:8788`). The class is
  React-free and standalone-instantiable.
- Main store (`store.ts`) keeps **only the latest `game_state` snapshot** — cumulative per-player
  `stats {darts,total_scored,three_dart_avg}`, `winner`, `players`, `mode`; `visit` is only the current
  visit. **No per-throw log, no local game_id in the UI.**
- App HTTP is relative (`/api/history/*`); `careerSummary.ts` does `fetch(`${base}/api/history/stats`)`.
- No settings store/view. Per-feature localStorage keys (`VideoToggle`, etc.).
- Opponent card: data-channel `{t:"card"}` → `RemoteMatchOptions.onOpponentCard(profile, summary)`;
  rendered by `OpponentCard`. `RemoteMatch` is the single data-channel owner.
- Nav: `NavTab = "live"|"history"|"multiplayer"|"profile"` in `App.tsx`. Views use vitest+jsdom+RTL,
  mocking `globalThis.fetch`. Commands: `npm --prefix ui run test`, `npm --prefix ui run build`.

---

## Section 1 — Identity & recovery key
**`ui/src/multiplayer/player.ts` (extend):** `Profile` gains `writeToken: string`. `getOrCreatePlayer()`
back-fills a `crypto.randomUUID()` `writeToken` if absent and persists (same migration shape used for
`avatar.color`). New players get one at creation. Storage key unchanged (`granbridge.player`).

**`ui/src/multiplayer/recoveryKey.ts` (new):**
- `exportRecoveryKey(p: {id; writeToken}): string` → `btoa("granbridge:" + id + ":" + writeToken)`.
- `importRecoveryKey(s: string): {id: string; writeToken: string}` → `atob`, split on `:` (exactly the
  `granbridge` prefix + 2 parts; the id/token are UUIDs with no internal `:`), validate non-empty;
  throw `Error("invalid recovery key")` on any malformation.
- A separate `applyRecoveryKey(s)` in `player.ts` restores `{id, writeToken}` into the persisted
  profile (keeping current name+avatar, or re-deriving avatar color from the new id), returns the
  updated `Profile`. (Pure codec stays in `recoveryKey.ts`; persistence stays in `player.ts`.)

## Section 2 — `statsClient.ts` (new, `ui/src/stats/`)
Pure-ish module; no React. Functions:
- `brokerHttpBase(wsUrl = readBrokerUrl()): string` — `wss://h` → `https://h`, `ws://h` → `http://h`
  (strip trailing `/`). Mirrors `smoke.py`'s transform.
- `submitMatch(record: MatchRecord, identity: {id; writeToken; name; avatarColor}, wsUrl?): Promise<{match_id; verified}>`
  — open `new WebSocket(wsUrl ?? readBrokerUrl())`; on open send
  `{type:"stats_submit", id, writeToken, player:{id,name,avatar:{color}}, match: record}`; resolve on
  `{type:"stats_ack"}`, reject `Error(code)` on `{type:"error",code}`; reject on close/timeout (≈8 s).
  Always `close()` in a `finally`.
- `fetchPlayerSummary(id, base = brokerHttpBase()): Promise<PlayerSummary>` — `GET ${base}/stats/player/${encodeURIComponent(id)}`; throw on non-OK.
- `fetchLeaderboard(metric: "avg"|"wins", limit = 20, base = brokerHttpBase()): Promise<{metric; players: LeaderRow[]}>`
  — `GET ${base}/stats/leaderboard?metric=${metric}&limit=${limit}`.

Types (`ui/src/stats/types.ts`): `MatchRecord` (matches the backend wire shape — `match_id, mode,
opponent_id, winner_id, is_remote, darts, total_scored, started_at, ended_at, throws?`), `PlayerSummary`
(mirrors `/stats/player` JSON), `LeaderRow`.

## Section 3 — App endpoint `GET /api/history/export/latest` (Python)
**`src/granbridge/history/store.py`:** add `export_latest_match(self) -> dict` — the most recent
**finished** game (`ended_at IS NOT NULL`, newest by id) joined with its `throws`, returned as a
canonical record: `{mode, players (names, from players_json), winner (name), started_at, ended_at,
throws:[{player, bed, score, ts}...]}`. Each throw includes its `player` (name) so the client can
extract its own slice for a hotseat game. Returns `{}` if none.
**`src/granbridge/cli.py`:** register `"/api/history/export/latest": store.export_latest_match` in the
existing `routes` dict (exact-path, zero-arg — no `StaticServer` change). Test in
`tests/api/` + a `HistoryStore` unit test.

## Section 4 — Match assembly + submit-on-game-over
**`ui/src/stats/useStatsSubmission.ts` (new hook)** subscribed to the main store; fires once when
`gameState.status` transitions to `"finished"`. Gated: if the upload toggle is off, do nothing.
- **Local/solo** (not currently in a remote match): `GET /api/history/export/latest` → take **my
  slice** of the throws (`throw.player === my profile name`); build a `MatchRecord` with those
  `throws` (bed/score/ts), `darts = mySlice.length`, `total_scored = sum(mySlice.score)`,
  `opponent_id = null`, `is_remote = false`, `match_id = crypto.randomUUID()`, `winner_id` = my id iff
  the game's winner name equals my profile name, else null. **Hotseat skip:** if my profile name is not
  among the game's players (e.g. generic "P1"/"P2" names), skip the upload — don't pollute my career
  with another player's throws. (Heatmap therefore reflects only games I played under my own name.)
- **Remote** (a remote match is active — see Section 6 state): build an **aggregate** `MatchRecord`
  from the final `game_state`: `darts`/`total_scored` from `stats[myName]`, `winner_id` mapped
  winner-name→id via the room roster (my id / opponent id), `opponent_id` = peer `profile.id`,
  `is_remote = true`, `match_id` = the shared host-minted id, `throws` omitted.
- Hand the record + identity to the offline queue (Section 5).
Mapping winner name→id: the local profile knows my name+id; the opponent's name+id come from the room
peer (`PeerInfo.player`). If the winner name matches neither (shouldn't happen), submit `winner_id:
null` (counts as unverifiable, harmless).

## Section 5 — Offline queue (`ui/src/stats/statsQueue.ts`, new)
localStorage FIFO under `granbridge.statsQueue`: array of `{record, identity}`.
- `enqueue(entry)` — append, persist, then `void flush()`.
- `flush()` — for each pending entry, `await statsClient.submitMatch(...)`; on success **or** a terminal
  error (`implausible`, `token_mismatch`, `unsupported`) drop it; on transient/network/timeout error
  keep it and stop (try again later). Persist after each change. Guard against concurrent flushes.
- Flush triggers: app start (once) and after any successful submit. Idempotent — the server dedupes on
  `(match_id, reporter_id)`, so re-sending a kept-but-actually-succeeded entry is safe.

## Section 6 — Remote `match_id` + opponent id (extend `RemoteMatch`)
- Extend `SyncMsg` with `{ t: "matchid"; id: string }` and `isSyncMsg` to validate it.
- **Host** mints `crypto.randomUUID()` when a remote game begins (first `state` send for a new game) and
  sends `{t:"matchid", id}`; it also holds the id locally.
- **Guest** stores the received `matchid`.
- `RemoteMatchOptions` gains `onMatchId?(id: string)` so `Multiplayer.tsx` can stash the current remote
  `match_id`; the peer `profile.id` (already available) is stashed as `opponent_id`. Section 4's remote
  path reads both. `RemoteMatch` remains the single data-channel owner (no second consumer).

## Section 7 — Opponent card from server (with fallback)
In `Multiplayer.tsx`'s `onOpponentCard(profile, summary)`: `try` `statsClient.fetchPlayerSummary(profile.id)`
→ map to `CareerSummary` and render that (trustworthy server card); `catch` → fall back to the
data-channel `summary` (today's MP-4 behavior). `OpponentCard` component unchanged. A tiny "verified"
hint may show when `verified_games > 0` (optional, low priority).

## Section 8 — Profile view additions (`ui/src/views/Profile.tsx`)
- **Recovery key:** an "Export recovery key" button (copies `exportRecoveryKey(...)`), and a
  "Restore from key" input + button (`applyRecoveryKey` → update state → refetch my server card), with a
  short warning that restoring replaces this device's identity.
- **My career card** prefers `statsClient.fetchPlayerSummary(myId)`; on error falls back to the existing
  local `/api/history/stats` summary (`fetchMyCareerSummary`). Label whether it's server or local.
- **Upload toggle:** "Upload my stats to the server" checkbox, `granbridge.uploadStats` (default on),
  read/written via a tiny helper (the `VideoToggle` pattern). The Section 4 hook reads it.

## Section 9 — Leaderboard view + nav tab
- `App.tsx`: add `"leaderboard"` to `NavTab`, a nav button (after Profile), and a render branch.
- `ui/src/views/Leaderboard.tsx` (new): on mount + on metric toggle, `statsClient.fetchLeaderboard(metric)`;
  render a table of rank, `<Avatar>` + name, 3-dart avg, wins, games (reuse `History`/`OpponentCard`
  styling). Avg/Wins toggle. Loading / empty ("no verified matches yet") / error states. A one-line note
  that only **verified** (co-signed) matches rank.

## Section 10 — File inventory
**New (UI):** `ui/src/multiplayer/recoveryKey.ts`, `ui/src/stats/statsClient.ts`,
`ui/src/stats/types.ts`, `ui/src/stats/statsQueue.ts`, `ui/src/stats/useStatsSubmission.ts`,
`ui/src/views/Leaderboard.tsx` (+ a `.test.tsx` for each).
**Modified (UI):** `ui/src/multiplayer/player.ts` (writeToken + applyRecoveryKey),
`ui/src/multiplayer/remoteMatch.ts` (`matchid` SyncMsg + `onMatchId`), `ui/src/views/Multiplayer.tsx`
(stash match_id/opponent_id; opponent card server+fallback; mount the submission hook),
`ui/src/views/Profile.tsx` (recovery key + server card + toggle), `ui/src/App.tsx` (Leaderboard tab),
and wherever the app is mounted (call `statsQueue.flush()` once on startup).
**Modified (Python):** `src/granbridge/history/store.py` (`export_latest_match`), `src/granbridge/cli.py`
(route). **New tests** alongside each.

## Section 11 — Testing
- **Pure/unit (UI):** `recoveryKey` export/import round-trip + malformed rejection; `player.ts`
  writeToken migration + `applyRecoveryKey`; `statsClient.brokerHttpBase` derivation; `statsClient`
  submit (mock `WebSocket`) ack/error/timeout; reads (mock `fetch`); `statsQueue` enqueue/flush, terminal
  vs transient handling, idempotent re-send, concurrent-flush guard.
- **Hook/integration (UI, jsdom):** `useStatsSubmission` — local path calls `/api/history/export/latest`
  and enqueues a full-throws record; remote path builds the aggregate record with the shared match_id +
  opponent_id; toggle-off enqueues nothing.
- **Component (UI):** opponent card prefers server then falls back on fetch error; Profile recovery
  export/import + toggle gating + server-then-local card; Leaderboard renders rows + metric toggle +
  empty/error states.
- **Python:** `export_latest_match()` returns the canonical record (mode, players, winner, timestamps,
  and `throws` each carrying `player`) and `{}` when no finished game; the `/api/history/export/latest`
  route serves it. Plus a UI test that the hotseat-skip + my-slice filtering work off this shape.
- Full UI suite + `npm --prefix ui run build` (tsc) green; full server + app suites stay green.

## Section 12 — Build order (for writing-plans)
1. **Identity:** `player.ts` writeToken migration + `recoveryKey.ts` (+ tests).
2. **App endpoint:** `HistoryStore.export_latest_match` + `cli.py` route (+ tests).
3. **statsClient + types:** `brokerHttpBase`, `submitMatch`, reads (+ tests, mocked WS/fetch).
4. **Offline queue:** `statsQueue.ts` (+ tests); call `flush()` on app startup.
5. **Submit-on-game-over:** `useStatsSubmission` (local path first; +tests), then wire the toggle.
6. **Remote plumbing:** `remoteMatch.ts` `matchid` SyncMsg + `onMatchId`; `Multiplayer.tsx` stashes
   match_id/opponent_id; remote assembly path in the hook (+tests).
7. **Profile:** recovery key UI + server career card + upload toggle (+tests).
8. **Opponent card:** server fetch + data-channel fallback in `Multiplayer.tsx` (+tests).
9. **Leaderboard:** view + nav tab (+tests).
10. **Docs:** BUILD-LOG entry; TARGET-FEATURES bumps (D cross-device card, E leaderboard UI → built).
    Then full UI + server + app suites + UI build green.

## Open items for planning
- **`game_state` lacks a timestamp in the UI types** — Section 4's local path takes `started_at`/`ended_at`
  from the app's `export/latest` (authoritative). The remote aggregate path needs an `ended_at`; use the
  client's `new Date().toISOString()` at game-over and a `started_at` captured when the remote game began
  (stash alongside the match_id in Section 6). Confirm during planning.
- **Detecting "remote match active" at game-over** — the submission hook must know whether the finished
  game was local or remote. Use the presence of a current remote `match_id`/`opponent_id` (set by Section
  6 while in a remote match, cleared on leave) as the signal.
