# MP-4: Player Profiles + Avatars — Design

> Sub-project after MP-3 (host-authoritative remote sync, merged). Brainstormed 2026-05-22.
> **UI-only** — no Python/bridge/engine/broker changes. Builds on the existing anonymous
> identity (`ui/src/multiplayer/player.ts`), the broker's pass-through `player` dict, the
> existing `/api/history/stats` endpoint, and MP-3's `RemoteMatch` data channel.

## Goal
Give each player a persistent **profile** (display name + avatar + persistent ID) and surface
**initials/color avatars** across the app, including the opponent's name, avatar, and a small
**career stat card** during a remote match.

## Scope (locked via brainstorming)
- **In:** local profile model + migration; avatar generation (initials + color) + `<Avatar>`
  component; a **Profile** view (edit name, pick color, copy ID, see *my* career stats); avatars
  in the multiplayer tiles / peer list / setup; opponent **name + avatar** in matches; opponent
  **career stat card** exchanged over the WebRTC data channel.
- **Out (deferred):** server-side profile/account storage; cross-device stat sync; per-identity
  history keying (stats remain keyed by display name); recording remote-match guest throws;
  uploaded-image avatars; avatars on the in-game scoreboard (optional stretch, not in this spec).
- **No backend changes:** the broker already forwards the whole `player` dict; `/api/history/stats`
  already exists. MP-4 touches only `ui/`.

## Data model (TypeScript)
```ts
// Avatar is fully reconstructable from (name → initials) + color.
export interface AvatarSpec { color: string }              // hex like "#f59e0b"
export interface Profile { id: string; name: string; avatar: AvatarSpec }
export interface CareerSummary { threeDartAvg: number; wins: number; gamesPlayed: number }
```
- `id` is the existing persistent UUID from `getOrCreatePlayer()`.
- **Migration:** existing localStorage `granbridge.player` holds `{id, name}` (no avatar). On load,
  if `avatar` is missing, derive `avatar.color = defaultAvatarColor(id)` and persist the upgraded
  object. New profiles get the derived color too (user can override later).

## Pure helpers (`ui/src/multiplayer/avatar.ts`, new)
- `defaultAvatarColor(id: string): string` — deterministic pick from a fixed palette by hashing
  `id` (sum char codes mod palette length). Palette is ~8 accessible, saturated hex colors.
- `initials(name: string): string` — uppercase, max 2 chars: if the trimmed name splits into ≥2
  tokens on non-alphanumerics, take the first letter of the first two tokens (e.g. `"Ada Lovelace" → "AL"`);
  otherwise the first two characters of the single token (e.g. `"Player-9f3a" → "PL"`). Empty/whitespace
  name → `"?"`.
- `AVATAR_PALETTE: string[]` — the exported palette (also used by the Profile color picker).

## Profile module (`ui/src/multiplayer/player.ts`, extend — keep file name for low churn)
Extend the existing identity to the richer `Profile`, preserving the current API:
- `getOrCreatePlayer(): Profile` — returns the persisted profile, **migrating** `{id,name}` →
  `{id,name,avatar:{color}}` (derive + persist color if absent). Still creates a new
  `{id: crypto.randomUUID(), name: "Player-<6>", avatar:{color: defaultAvatarColor(id)}}` if none.
- `setPlayerName(name): Profile` — unchanged behavior (updates name, persists, returns profile).
- `setPlayerColor(color: string): Profile` — new; updates `avatar.color`, persists, returns profile.
- Keep the storage key `granbridge.player`. All reads/writes go through these functions.

## Avatar component (`ui/src/components/Avatar.tsx`, new)
`<Avatar name={string} color={string} size={number=40} />` → a colored circle (background `color`)
with centered white `initials(name)`. Pure, no state. Accessible: `role="img"` +
`aria-label={`${name} avatar`}`. Used in the Profile view, video tiles, peer list, setup, and the
opponent card.

## Profile view (`ui/src/views/Profile.tsx`, new) + nav tab
A new top-level tab "Profile" (add to `App.tsx`'s `NavTab` union and nav bar, after History).
Contents:
- **Avatar preview** (`<Avatar>` at a larger size) reflecting the current name + color live.
- **Display name** text input → `setPlayerName` on change (debounced or on blur).
- **Color picker** — the `AVATAR_PALETTE` swatches + a "reset to default" (`defaultAvatarColor(id)`);
  selecting calls `setPlayerColor`.
- **Persistent ID** — read-only, shown truncated with a copy-to-clipboard button.
- **My career stats** — fetch `GET /api/history/stats`, find the row whose `player` equals my
  current display name, render `three_dart_avg`, `wins`, `games_played` (zeros if no row). A short
  note explains stats are local to this device and keyed by display name.

## Career summary helper (`ui/src/multiplayer/careerSummary.ts`, new)
- `async function fetchMyCareerSummary(name: string, base = ""): Promise<CareerSummary>` — `GET
  ${base}/api/history/stats`, find the row with `player === name`, map to
  `{ threeDartAvg: row.three_dart_avg, wins: row.wins, gamesPlayed: row.games_played }`; return
  zeros `{threeDartAvg:0, wins:0, gamesPlayed:0}` on no-match or fetch error. Pure-ish (injectable
  fetch base for tests).

## Broker / identity plumbing
- `brokerClient.ts`: extend `PeerInfo.player` from `{id,name}` to `{id; name; avatar?: AvatarSpec}`
  (avatar optional for forward-compat with peers that don't send it). No other broker-client change.
- `Multiplayer.tsx` join: pass the full profile in `bc.join(room, pw, { id, name, avatar })`
  (the broker forwards the whole `player` dict unchanged — verified in `server/.../broker.py`).
- When rendering an opponent whose `player.avatar` is absent (older client), fall back to
  `defaultAvatarColor(player.id)`.

## Opponent stat card over the data channel (extend `RemoteMatch`)
Keep `RemoteMatch` the **single** data-channel owner (the MP-3 review warned a second owner would
clobber the callbacks). Add a symmetric card-exchange message:
- Extend `SyncMsg` with `{ t: "card"; profile: Profile; summary: CareerSummary }`.
- Extend `isSyncMsg` to validate the `card` variant (object `profile` with string `id`/`name`;
  object `summary`).
- `RemoteMatchOptions` gains:
  - `selfCard?: { profile: Profile; summary: CareerSummary }` — what this client advertises.
  - `onOpponentCard?: (profile: Profile, summary: CareerSummary) => void`.
- On **channel open**, BOTH roles send `{ t:"card", ...selfCard }` (in addition to the host's
  existing state re-send). This makes card exchange symmetric and independent of who is host.
- In `_onPeerMessage`, a `{t:"card"}` message (either role) calls `onOpponentCard(profile, summary)`.
- This is additive: dart/state routing and the host/guest gate are unchanged.

## Multiplayer view wiring (`Multiplayer.tsx`)
- Build `selfCard` once in the room: `profile = getOrCreatePlayer()`, `summary = await
  fetchMyCareerSummary(profile.name)`; pass `{ selfCard, onOpponentCard }` into the `RemoteMatch`
  constructor (alongside MP-3's role/peer/bridge/applyState).
- Hold `opponentCard` in component state; `onOpponentCard` sets it.
- Render: my local `<Avatar>` on my tile (and name); each peer tile shows the peer's avatar+name;
  the **opponent card** (avatar, name, 3-dart avg / wins / games) shown near the tiles when received.
- `VideoTile` gains optional `avatarName?: string` + `avatarColor?: string`; when there is no
  stream (cam off / not yet connected), render a centered `<Avatar>` instead of the empty black box.

## File inventory
**New:** `ui/src/multiplayer/avatar.ts`, `ui/src/multiplayer/careerSummary.ts`,
`ui/src/components/Avatar.tsx`, `ui/src/views/Profile.tsx` (+ tests for each).
**Modified:** `ui/src/multiplayer/player.ts` (+test), `ui/src/multiplayer/brokerClient.ts`
(PeerInfo type), `ui/src/multiplayer/remoteMatch.ts` (+test, card exchange),
`ui/src/components/VideoTile.tsx`, `ui/src/views/Multiplayer.tsx` (+test), `ui/src/App.tsx` (nav tab).
**No Python / broker / engine changes.**

## Testing (vitest, jsdom)
- **Pure:** `initials()` cases (two-token, single-token, empty, non-alphanumeric); `defaultAvatarColor()`
  determinism + palette membership; `player.ts` migration (`{id,name}` → adds color, persists),
  `setPlayerColor`/`setPlayerName` round-trips via localStorage.
- **Component:** `<Avatar>` renders the initials + applies the color; `aria-label` present.
- **careerSummary:** matches the row by name; zeros on no-match / fetch error (mock `fetch`).
- **RemoteMatch:** on channel open both roles send `{t:"card"}`; receiving `{t:"card"}` calls
  `onOpponentCard`; malformed card rejected by `isSyncMsg`; existing dart/state tests still pass.
- **Profile view:** renders name input, color swatches, truncated ID + copy button, and stats from a
  mocked `/api/history/stats`.
- **Multiplayer:** opponent tile renders an `<Avatar>` when no stream; opponent card renders after
  `onOpponentCard` fires (drive via store/state).
- Full suite + `npm --prefix ui run build` (tsc) must stay green.

## Known limitations (documented for users / MP-5+)
- Career stats are keyed by **display name** (existing behavior); renaming splits history, and
  remote-match guest throws aren't recorded — so the opponent card reflects each player's *local*
  stats only. True per-identity, cross-device stats need the deferred **server-side** profile store.
- Avatars are initials+color (no images) by design; uploaded images are deferred.

## Build order (for writing-plans)
1. Pure foundation: `avatar.ts` helpers + `player.ts` profile/migration (+tests).
2. `<Avatar>` component (+test).
3. `careerSummary.ts` (+test).
4. `Profile.tsx` view + `App.tsx` nav tab (+test).
5. `RemoteMatch` card exchange + `PeerInfo`/join avatar plumbing (+tests).
6. `VideoTile` avatar + `Multiplayer.tsx` wiring (self/opponent avatars + opponent card) (+tests).
7. Docs: update `BUILD-LOG.md` (MP-4 entry); note limitations.
Then full suite + build green.
