# Server-Side Stats — Design

> Sub-project picking up the thread MP-4 explicitly deferred: *"true per-identity,
> cross-device stats need the deferred server-side profile store."* Brainstormed 2026-05-24.
> Branch: `server-side-stats` (off `main`).

## Goal

Make player stats persist **server-side, keyed by a durable identity**, so a player's career
travels across devices and reinstalls; so remote opponents see **trustworthy** career stats; and
so there is a **global leaderboard** — all on the existing self-hosted broker, with zero new
recurring cost and the project's anonymous, no-accounts ethos intact.

This is the union of four layers on one shared foundation:

| Layer | Delivers | Built from |
|---|---|---|
| 0. Durable identity | stats survive reinstall / new device | recovery key (public id + private write-token) |
| 1. Ingestion + storage | a durable, queryable match archive | `/stats/submit` + SQLite on a volume |
| 2. My-stats query | cross-device personal career | `GET /stats/player/{id}` |
| 3. Opponent card | trustworthy in-match opponent stats | `GET /stats/player/{id}` (replaces MP-4's self-reported card) |
| 4. Leaderboard | global ranking | `GET /stats/leaderboard` + verification |

## Locked decisions (via brainstorming)

1. **Scope:** all four layers, as one coherent subsystem (1–3 share most of the code).
2. **Identity:** recovery key — no accounts. Public UUID + private write-token; trust-on-first-use.
3. **Ingestion:** all matches (local + remote) by default, **user-toggled** (global switch + per-match
   opt-out), with an **offline queue** that flushes when online.
4. **Architecture:** embed in the existing broker — new `/stats/*` HTTP routes + SQLite on a Docker
   `data` volume. No new service, no new recurring cost.
5. **Trust:** **verified-only leaderboard** — only co-signed matches (both participants submitted the
   same match and agreed on the winner) rank publicly; solo/practice counts toward your *personal*
   career card but is excluded from ranking.

## Non-goals (deferred)

- Accounts / passwords / email / matchmaking.
- Hardcore anti-cheat (CV verification, server-side match refereeing, device attestation).
- Server-running the match (authority stays host-authoritative P2P; the server only *records* results).
- Server-side avatars-as-images, social graph / friends, tournaments.
- Postgres / multi-node scaling (SQLite is sufficient at current scale; revisit if needed).

---

## Section 1 — Identity & recovery key (Layer 0)

A player identity splits into a public part and a private part:

- **`id`** — the existing `crypto.randomUUID()` from `ui/src/multiplayer/player.ts`. **Public**: it is
  already broadcast to opponents in the room `player` dict (used for avatars/cards). It is the stats key.
- **`writeToken`** — a new client-generated secret (`crypto.randomUUID()`), stored in localStorage
  beside `id`. **Never** sent in rooms. Authorizes writes for `id`.
- **Recovery key** — one copy-pasteable string: `base64("granbridge:" + id + ":" + writeToken)`.
  The user backs it up; pasting it into a new device restores both halves, so stats follow them.

**Trust-on-first-use (TOFU):** the first `/stats/submit` for an `id` stores `sha256(writeToken)` in the
`players` row. Later writes must present a token whose `sha256` matches, else `403 token_mismatch`.
Because `id` is public but `writeToken` is not, an opponent who knows your `id` still cannot write as you.

**Migration:** `player.ts` gains `writeToken` on load if absent (generate + persist) — exactly the
pattern MP-4 used to add `avatar.color`. Storage key stays `granbridge.player`.

```ts
export interface Profile { id: string; name: string; avatar: AvatarSpec; writeToken: string }
```

## Section 2 — Server schema & API

New module `server/granbridge_broker/stats.py` holds a `StatsStore` (SQLite, one connection per call,
WAL mode), plus route handlers wired into the broker's existing HTTP table. DB path from env
`STATS_DB_PATH` (default `/data/stats.db`), on a new Docker `data` volume.

**Schema** (mirrors the local `HistoryStore` grain but keyed by `id` + match-dedupe):

```sql
players(
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  display_name TEXT,
  avatar_color TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
)
matches(
  match_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,          -- who submitted this row
  mode TEXT NOT NULL,
  opponent_id TEXT,                   -- NULL for solo
  winner_id TEXT,
  is_remote INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, reporter_id) -- one row per (match, reporter); dedupe on re-submit
)
match_throws(
  match_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  player_id TEXT NOT NULL,            -- always == reporter_id (you only submit your own darts)
  bed TEXT NOT NULL,
  score INTEGER NOT NULL,
  ts TEXT NOT NULL
)
```

Indexes: `matches(reporter_id)`, `matches(verified)`, `match_throws(reporter_id)`.

**Endpoints** (JSON; same port; `Access-Control-Allow-Origin: *` like `/turn` and `/healthz`):

- `POST /stats/submit` — body = `MatchRecord` + `id` + `writeToken`.
  Validates token (TOFU), applies **sanity caps** (Section 3), upserts the player (name/color/last_seen),
  **dedupes** on `(match_id, reporter_id)` (idempotent — re-submitting the same match is a no-op
  upsert), records throws, recomputes `verified`. The only write endpoint.
- `GET /stats/player/{id}` — public career summary for *any* id (drives my Profile card **and** the
  opponent card): `{ id, display_name, avatar_color, games_played, wins, three_dart_avg, darts,
  total_scored, heatmap: {bed: count}, verified_games }`. Aggregated from that id's own submitted throws.
- `GET /stats/leaderboard?metric=avg|wins&limit=N` — ranked players, **verified matches only**
  (min games threshold to appear, e.g. ≥3, to keep noise out).
- `GET /healthz` — extend the existing payload with `players` and `matches` counts.

**Wire format** (`MatchRecord`, shared TS/Python shape):

```jsonc
{
  "match_id": "<sha256(sorted(playerIds)+startedAt)>",  // both participants compute the same id
  "mode": "x01",
  "opponent_id": "<uuid|null>",
  "winner_id": "<uuid|null>",
  "is_remote": true,
  "started_at": "ISO8601",
  "ended_at": "ISO8601",
  "throws": [ { "bed": "T20", "score": 60, "ts": "ISO8601" }, ... ]  // reporter's own darts only
}
```

## Section 3 — Trust / verification model

- A submission writes **only the reporter's own darts** (`player_id == reporter_id`, enforced) — you
  cannot fabricate an opponent's throws or directly write to their career.
- **Deterministic `match_id`** = `sha256(join(sort([myId, opponentId])) + started_at)`. Both
  participants compute the identical id independently, with no coordination.
- **Verified** = there exist two `matches` rows with the same `match_id`, distinct `reporter_id`s, and
  **agreeing `winner_id`**. Recompute on each submit; flip both rows' `verified=1` when the pair agrees.
  Disagreement on winner → leave unverified (a "dispute"; never auto-resolved).
- **Sanity caps on ingest** (reject the record with `422 implausible`, or flag, on violation):
  - no visit (3 consecutive darts of one player) summing > 180;
  - every `bed` must be a valid code (reuse `segment_map`); `score` must match the bed;
  - per-`id` submit rate-limited (reuse `RateLimiter`, env `STATS_RATE_PER_MIN`);
  - bounded `throws` length and payload size (`max_size` already guards the socket; mirror for HTTP body).
- **Leaderboard policy:** ranks **verified** matches only. Solo/practice has no second reporter, so it
  never verifies — it counts toward your **personal** `GET /stats/player/{id}` card (labeled
  "includes unverified") but is excluded from `GET /stats/leaderboard`.

## Section 4 — Client integration (UI is the stats client)

The **UI** owns identity, transport, auth, and the offline queue. **Python stays the authoritative
match source** — the UI never re-derives throws.

- **Match source:** add a small local endpoint `GET /api/history/export/{game_id}` (Python) returning a
  canonical `MatchRecord` built straight from `HistoryStore` (games + throws for that game). On
  game-over the UI fetches this, attaches `id`/`writeToken`, computes `match_id`, and `POST`s to the
  broker `/stats/submit`.
  - *Solo:* `opponent_id=null`, throws = the player's darts.
  - *Remote (host-authoritative):* the host's `HistoryStore` has the full match; **each side submits its
    own darts** for the shared `match_id` so the match can verify. The guest builds its `MatchRecord`
    from its own local record / event stream (guest-side recording is the one Python-side gap to close;
    see Open items).
- **Offline queue:** failed/offline submissions persist in localStorage (`granbridge.statsQueue`) and
  flush on reconnect (the UI already has `BrokerClient` connectivity signals). Idempotent submit makes
  retries safe.
- **Settings toggle:** a global "Upload my stats" switch (default on) + a per-match opt-out, honoring
  the record-all-but-toggled decision. Off ⇒ nothing leaves the device; queue is not populated.
- **Opponent card:** replace MP-4's self-reported data-channel card with `GET /stats/player/{opponentId}`
  when online; **fall back** to the data-channel card if the server is unreachable. The data-channel
  card path (MP-4) stays as the offline fallback.
- **Profile view:** add **recovery-key export/import** (copy / paste-to-restore) and switch *my* career
  card to the server summary when available (local card as fallback).
- **Leaderboard view:** new top-level tab, reusing the table + `Avatar` patterns from `History.tsx` /
  `Profile.tsx`; metric toggle (avg / wins).

## Section 5 — Concurrency, privacy, ops

- **Concurrency:** convert the broker's `_process_request` to `async` (supported in websockets 15) and
  run all SQLite work via `asyncio.to_thread`, so a stats query never stalls WebRTC signaling. WAL mode;
  one connection per call (same idiom as the local `HistoryStore`).
- **Privacy:** only user-set display name + avatar color + gameplay numbers are stored — no PII,
  anonymous ids. Toggle off ⇒ no upload. `/stats/player/{id}` is intentionally public (stats aren't
  secret; the id is already public in rooms).
- **Ops:**
  - compose: new named `data` volume mounted `rw` to the broker; env `STATS_DB_PATH=/data/stats.db`.
  - `config.from_env`: add `stats_db_path`, `stats_rate_per_min` (default e.g. 30).
  - `smoke.py`: add a `/stats/*` round-trip check — submit a throwaway-id record, read it back via
    `GET /stats/player/{id}`, confirm aggregation. Distinct SKIP if stats disabled.
  - `server/README.md`: document the `data` volume + a one-line backup note (copy `stats.db`).

## Section 6 — File inventory

**Server (new):** `granbridge_broker/stats.py` (StatsStore + handlers),
`tests/test_stats_store.py`, `tests/test_stats_api.py`, `tests/test_stats_integration.py` (docker-gated,
real volume, like the coturn one).
**Server (modified):** `granbridge_broker/broker.py` (async `_process_request`, `/stats/*` routes,
StatsStore wiring, `/healthz` counts), `granbridge_broker/config.py` (+ `stats_db_path`,
`stats_rate_per_min`), `granbridge_broker/__main__.py` (pass new config), `docker-compose.yml`
(`data` volume + env), `smoke.py` (+ stats check), `README.md`.
**App / Python (new/modified):** `src/granbridge/api/...` — add `GET /api/history/export/{game_id}`;
possibly a small `MatchRecord` builder on `HistoryStore`; guest-side match recording for remote matches
(close the gap so both sides can submit).
**UI (new):** `ui/src/multiplayer/recoveryKey.ts` (encode/decode + writeToken), `ui/src/stats/`
(`statsClient.ts` submit/query, `statsQueue.ts` offline queue, `matchId.ts` deterministic id),
`ui/src/views/Leaderboard.tsx` (+ test).
**UI (modified):** `ui/src/multiplayer/player.ts` (writeToken migration), `ui/src/views/Profile.tsx`
(recovery key + server card), `ui/src/views/Multiplayer.tsx` (opponent card from server + fallback),
settings UI (upload toggle), `ui/src/App.tsx` (Leaderboard nav tab). `+ tests for each`.

## Section 7 — Testing

- **Pure/unit (server):** token TOFU + mismatch (`403`); recovery-key encode/decode round-trip;
  deterministic `match_id` (order-independent); sanity-cap rejection (>180 visit, bad bed); verification
  flip when both reporters agree; dispute stays unverified; idempotent re-submit.
- **Server API:** submit → player → leaderboard happy paths; dedupe; rate-limit `429`; `/healthz` counts;
  leaderboard excludes solo/unverified + honors min-games threshold.
- **Concurrency:** submit during active signaling doesn't block (integration/smoke level).
- **App/Python:** `/api/history/export/{game_id}` returns canonical `MatchRecord`; guest recording path.
- **UI (vitest/jsdom):** offline queue flush + idempotent retry; recovery export/import; opponent card
  prefers server then falls back to data-channel; upload toggle gates submission; leaderboard renders +
  metric toggle.
- Full Python + UI suites + `npm --prefix ui run build` (tsc) stay green; docker-gated integration test
  like the existing real-coturn one.

## Section 8 — Build order (for writing-plans)

1. **Server foundation:** `StatsStore` + schema (+ unit tests). Pure, no broker wiring yet.
2. **Identity/trust pure helpers:** token TOFU, recovery-key codec, deterministic `match_id`, sanity
   caps (shared logic; tests).
3. **Broker wiring:** async `_process_request`, `/stats/*` routes, config + compose `data` volume,
   `/healthz` counts (+ API tests).
4. **App match source:** `GET /api/history/export/{game_id}` + canonical `MatchRecord`; guest-side
   remote-match recording (+ tests).
5. **UI plumbing:** `player.ts` writeToken migration, `recoveryKey.ts`, `matchId.ts`, `statsClient.ts`,
   `statsQueue.ts` (+ tests).
6. **UI surfaces:** Profile (recovery key + server card), Multiplayer opponent card (server + fallback),
   upload toggle, Leaderboard view + nav tab (+ tests).
7. **Ops + docs:** `smoke.py` stats check, `README.md` volume/backup, `BUILD-LOG.md` entry,
   `TARGET-FEATURES.md` status bumps (D → built; leaderboard E).
   Then full suites + build green; docker-gated integration test.

## Open items to resolve during planning

- **Guest-side recording for remote matches:** the host's `HistoryStore` records the full match today;
  the guest's local record of a remote match may be partial. Verified matches need *both* sides to
  submit their own darts under the shared `match_id`, so planning must confirm/define the guest's local
  record (likely a small addition to the MP-3 `RemoteMatch` → local history path).
- **Min-games threshold** for leaderboard appearance (start ≥3; tune later).
- **Backup cadence** for `stats.db` — out of scope to automate now; README note + volume is enough.
