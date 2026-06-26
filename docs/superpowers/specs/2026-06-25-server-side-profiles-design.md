# Server-side Profiles — Design (v0.1.8 / server-v0.4.0)

**Date:** 2026-06-25
**Status:** Approved (brainstorming), pending implementation
**Scope:** Make the already-built, now-live server profile/stats subsystem *richer*.
Three additive capabilities on top of the live `/stats/*` backend.

## Background

Server-side stats/profiles are fully built and, as of server-v0.3.0, **live** on
`darts.aventador.io` (`/stats/leaderboard` returns 200; `/stats/player/<id>` and
`/healthz` work; reads are HTTP GET, writes go over a transient WebSocket
`stats_submit`, auth is trust-on-first-use (TOFU) write-tokens). Today a "profile"
is only a *side-effect of submitting a match* — `display_name`/`avatar_color` are
written by `submit_match` and nothing else. This version makes profiles first-class
and surfaces data the schema already captures.

### In scope (this version)

1. **Match history timeline** — per-player list of recent games, shown in `Profile`.
2. **Head-to-head records** — "vs you: 4–2" rivalry tally, shown on the opponent card.
3. **First-class profile** — a dedicated `bio` field + a profile-update write path so
   name/avatar/bio changes propagate **without** playing a match.

### Out of scope (deferred)

- Public/shareable profile pages (view-anyone-by-ID web pages).
- Avatar image uploads (still color-only).
- Achievements/badges.
- Extra profile fields beyond `bio` (country flag, favorite double) — cheap to add
  later, omitted now per YAGNI.

### Decisions baked in

- New profile field this version: **`bio` only**.
- Match-history placement: **`Profile` view only** (the opponent card gets H2H, not a
  history list).

## Architecture (Approach A: extend existing patterns, additive)

Reads = HTTP GET, writes = transient-WS message, auth = TOFU write-token. Nothing
existing is restructured; every piece is independently testable.

### 1. Data model & migration

`players` gains one nullable column:

```
players:  + bio TEXT     -- nullable; <= 160 chars after validation/strip
```

The live v0.3.0 DB already created `players` without `bio`, and
`CREATE TABLE IF NOT EXISTS` will not add a column to an existing table. So
`StatsStore._init_tables()` gets an idempotent migration: read `PRAGMA
table_info(players)`; if `bio` is absent, run `ALTER TABLE players ADD COLUMN bio
TEXT`. Metadata-only, safe on every boot; existing rows get `bio = NULL`.

History and head-to-head require **no schema change** — they read from the existing
`matches` (and `players` for opponent display names) tables.

### 2. Server — new store methods

`granbridge_broker/stats.py`:

- `recent_matches(player_id, limit=20, offset=0) -> list[dict]`
  Newest-first (`ORDER BY started_at DESC`), `LIMIT`/`OFFSET`. `limit` clamped to
  `[1, 100]`, `offset >= 0`. Each row:
  `{match_id, mode, opponent_id, opponent_name, is_remote, won, verified,
    three_dart_avg, started_at, ended_at}` where `won = (winner_id == player_id)`,
  `three_dart_avg = round(total_scored / darts * 3, 2)` (0.0 when darts == 0),
  `opponent_name` is a LEFT JOIN to `players.display_name` on `opponent_id`.

- `head_to_head(a, b) -> dict`
  Computed from `a`'s reporter rows where `opponent_id == b`. Returns
  `{a, b, games, a_wins, b_wins, last_played, pending}`. Headline `games/a_wins/
  b_wins` count **verified** matches; `pending` counts reported-but-unverified ones;
  `last_played` is the max `started_at` over all (verified+pending). `a == b` returns
  all-zero. Unknown ids return all-zero (no error).

- `update_profile(player_id, write_token, display_name="", avatar_color="", bio="")
   -> dict`
  Same TOFU as `submit_match`: if the player row is absent, INSERT it (registering
  `sha256(token)`) — **so a profile can exist before any match**; else verify the
  token with `hmac.compare_digest` (raise `PermissionError` on mismatch) and UPDATE
  `display_name, avatar_color, bio, last_seen`. `bio` is stripped of surrounding
  whitespace and control characters; a `bio` longer than 160 chars is **rejected**
  with `ValidationError` (never silently truncated). Empty/whitespace `bio` stores
  `NULL`. Returns the stored `{id, display_name, avatar_color, bio}`.

- `player_summary(...)` extended to SELECT and return `bio`.

### 3. Server — new routes & WS message

`granbridge_broker/broker.py`:

- `GET /stats/player/<id>/matches?limit=&offset=` — **must be matched before** the
  bare `/stats/player/<id>` branch in `_handle_stats_get`, stripping the `/matches`
  suffix to recover `id` (otherwise the existing handler parses `id` as
  `"<id>/matches"`). Returns `{player_id, matches: [...]}`.
- `GET /stats/h2h/<a>/<b>` — parse two path segments; 400 on missing/over-long ids.
  Returns the `head_to_head` dict.
- WS message `profile_update` — mirrors the `stats_submit` handler arm:
  guard `self._stats is not None` (else `unsupported`), per-peer stats rate limiter,
  require string `id` + `writeToken` (`bad_request` otherwise), read
  `player.name`, `player.avatar.color`, `player.bio`, call `update_profile`, reply
  `{type: "profile_ack", id, bio}`. Reuse error codes: `token_mismatch`,
  `rate_limited`, `implausible` (bio too long), `server_error`.

Both GET routes are already covered by the per-IP `_stats_limiter` applied to every
`/stats/` path.

### 4. Client — data layer

`ui/src/stats/types.ts`:
- `+ bio?: string | null` on `PlayerSummary`.
- `interface MatchHistoryRow { match_id; mode; opponent_id; opponent_name;
  is_remote; won; verified; three_dart_avg; started_at; ended_at }`.
- `interface HeadToHead { a; b; games; a_wins; b_wins; last_played; pending }`.

`ui/src/stats/statsClient.ts`:
- `fetchPlayerMatches(id, limit=20, offset=0, base?) -> { player_id; matches: MatchHistoryRow[] }` (HTTP GET).
- `fetchHeadToHead(a, b, base?) -> HeadToHead` (HTTP GET).
- `updateProfile(identity, fields: {name?; color?; bio?}, wsUrl?, timeoutMs?) ->
  Promise<{ id; bio }>` — transient WS mirroring `submitMatch`: send
  `{type:"profile_update", id, writeToken, player:{name, avatar:{color}, bio}}`,
  resolve on `profile_ack`, reject on `error`/timeout/close.

`ui/src/multiplayer/player.ts`:
- `+ bio?: string` on `Profile`; legacy records migrate on read (same backfill
  pattern as `writeToken`).
- `setPlayerBio(bio: string) -> Profile`.

### 5. Client — UI

`ui/src/views/Profile.tsx`:
- **Bio:** a textarea bound to `profile.bio` (maxLength 160, char counter).
- **Recent games:** a list fetched via `fetchPlayerMatches(profile.id)`, rendered
  newest-first with opponent name, mode, W/L, 3-dart avg, relative date. Graceful
  empty state ("No games on the server yet") and offline state (hidden / "server
  unreachable"), consistent with the existing server/local fallback for the summary.
- **Propagation:** name/color/bio edits fire a **debounced** `updateProfile`, gated
  by the existing upload toggle (`getUploadEnabled`). Best-effort: silently no-ops
  when offline (the next successful match submit also carries name/color, and the
  next edit retries). No offline queue for profile edits in v1.

`ui/src/components/OpponentCard.tsx`:
- Add optional `headToHead?: HeadToHead` prop; when present and `games > 0`, render a
  rivalry line ("vs you: 4–2"). The pre-match lobby that renders `OpponentCard`
  fetches `fetchHeadToHead(myId, oppId)`.

```
 Opponent card (pre-match)            Profile > Recent games
 +-----------------------------+      +-------------------------------+
 | (o) Alex           Avg Wins |      | vs Alex   501   W   60.2  2d  |
 |     vs you: 4-2    58.1  12 |      | vs Sam    Cri   L   54.0  5d  |
 +-----------------------------+      | vs Alex   501   W   61.5  1w  |
                                      +-------------------------------+
```

## Error handling, privacy, limits

- Unknown player/opponent -> `recent_matches`/`head_to_head` return empty/zeros
  (consistent with `player_summary`); 400 on malformed ids; 404 unknown route; 500
  wrapped — the existing `_handle_stats_get` contract.
- **Privacy:** history and H2H are **public** for any id, exactly like
  `player_summary` and the leaderboard today. The `uploadStats` toggle still governs
  whether *your* data ever reaches the server. `bio` is opt-in published text.
- `profile_update` shares the per-peer stats limiter; the GET routes share the
  per-IP `_stats_limiter`.

## Testing

**Server (pytest):**
- `recent_matches`: ordering (newest first), limit clamp, offset paging,
  opponent_name join, won/verified flags, avg computation, empty for unknown player.
- `head_to_head`: verified vs pending tallies, a_wins/b_wins correctness,
  last_played, self-vs-self zeros, unknown-ids zeros.
- `update_profile`: TOFU create (no prior match), token mismatch -> PermissionError,
  bio length validation (>160 rejected), bio surfaced by `player_summary`.
- routing: `/stats/player/<id>/matches` not swallowed by the bare player route;
  `/stats/h2h/<a>/<b>` parsing + 400s.
- `profile_update` WS: happy path -> `profile_ack`; error codes (token_mismatch,
  unsupported when stats disabled, bad_request, implausible).

**Client (vitest):**
- `statsClient`: `fetchPlayerMatches`/`fetchHeadToHead` success + non-OK throw;
  `updateProfile` resolves on ack / rejects on error/timeout.
- `Profile.test`: bio edit updates state + fires (debounced) `updateProfile`;
  recent-games list renders rows and the empty state.
- `OpponentCard.test`: H2H line renders when present, absent when `games == 0` /
  prop missing.
- `player.test`: `setPlayerBio`; legacy record without `bio` migrates cleanly.

## Rollout / versioning

All changes are backward-compatible (new column nullable; new routes/WS message
ignored by old peers; new response fields optional), so deploy order is safe either
way. Natural sequence:

1. **server-v0.4.0 -> TOWER** (includes the `bio` migration; additive).
2. **client v0.1.8** (full release; never `--prerelease` per the auto-updater rule).

Old clients keep working against the new broker; new clients degrade gracefully
against an un-upgraded broker (reads 404 -> local fallback; `profile_update` -> no
ack -> silent best-effort).
