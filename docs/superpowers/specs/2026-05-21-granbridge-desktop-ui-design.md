# GRANBRIDGE — Sub-project 3: "Desktop UI" (Design Spec)

- **Date:** 2026-05-21
- **Status:** Self-approved under the autonomous-build mandate (user pre-approved all decisions).
- **Depends on:** SP1 (WebSocket event feed) + SP2 (game engine + bidirectional command channel).
- **Toolchain:** Node 24 + npm present. **Rust/Cargo absent** → the Tauri *native wrapper* is
  scaffolded/configured but cannot be compiled in this environment; the web app runs via Vite today
  and is Tauri-ready.

---

## 1. Goal & Success Criteria

A modern, TV-friendly desktop UI for GRANBRIDGE that connects to the bridge's WebSocket, shows
live game state, and drives games via the command channel.

**Done when:**
1. `npm install && npm run build` succeeds; `npm run dev` serves the app.
2. The app connects to `ws://127.0.0.1:8787`, shows connection status, and auto-reconnects.
3. A **Setup** screen starts a game (`start_game`) — pick mode (X01/Cricket/ATC/Free-play),
   players, and mode options.
4. A **Live** screen renders the active mode's scoreboard from `game_state` (X01 remaining +
   checkout; Cricket marks grid + points; ATC target; Free-play stats), highlighting the active player.
5. **Controls** issue `next_player`, `record_miss`, `undo`, `correct_last`, `end_game`.
6. Transition events (`bust`, `leg_won`, `game_won`) surface as transient banners.
7. Vitest unit tests cover the store, the WS hook (mocked socket), and key components; all green, CI-safe.

**Non-goals:** match history persistence, auth, online play, the native Tauri build (scaffold only).

---

## 2. Design Decisions

- **Stack:** React 18 + TypeScript + Vite + Tailwind CSS + Zustand. Vitest + React Testing Library
  + jsdom for tests. ESLint optional (skip to reduce churn).
- **State:** a single Zustand store holds `connection` status, the latest `GameState`, and a small
  ring buffer of recent transition events. The WS hook feeds the store; components select from it.
- **Transport:** one `useGranbridgeSocket` hook owns the WebSocket lifecycle (connect, reconnect
  with backoff, parse inbound events into the store, expose a typed `send(command)`).
- **Types:** a hand-written `types.ts` mirrors the bridge's event/command JSON contracts (kept in
  sync with `src/granbridge/events/schema/` and `game/commands.py`). Single source of truth on the TS side.
- **Theme:** dark, high-contrast, large type ("arcade/Big-Picture" feel), responsive down to a phone
  and up to 4K; a `?kiosk=1` query param hides chrome for OBS/fullscreen.
- **Location:** `ui/` at the repo root (separate from the Python package). Tauri config under `ui/src-tauri/`.

---

## 3. Architecture

```
WebSocket (ws://127.0.0.1:8787)
   │  inbound events (game_state, bust, leg_won, game_won, connection_state, error)
   ▼
useGranbridgeSocket ──▶ Zustand store (connection, gameState, banners)
   ▲                        │ selectors
   │ send(command)          ▼
   └──────────────  React views: <Setup> | <LiveGame> (mode scoreboards) + <Controls> + <Banners>
```

Components are pure functions of store state; the hook is the only side-effecting unit. Mode
scoreboards are dispatched by `gameState.mode` (`X01Board`, `CricketBoard`, `AtcBoard`, `FreePlayBoard`).

---

## 4. Component / File Inventory (`ui/`)

| File | Responsibility |
|------|----------------|
| `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `index.html` | scaffold |
| `src/main.tsx`, `src/App.tsx`, `src/index.css` | entry, root layout, Tailwind base |
| `src/types.ts` | TS types for events + commands (mirror of the bridge contracts) |
| `src/store.ts` | Zustand store: `connection`, `gameState`, `banners`, actions |
| `src/useGranbridgeSocket.ts` | WS lifecycle hook: connect/reconnect, dispatch events, `send()` |
| `src/views/Setup.tsx` | mode/player/options form → `start_game` |
| `src/views/LiveGame.tsx` | dispatches to the right mode board + shows active player |
| `src/components/boards/{X01Board,CricketBoard,AtcBoard,FreePlayBoard}.tsx` | per-mode scoreboards |
| `src/components/Controls.tsx` | next/miss/undo/correct/end buttons → commands |
| `src/components/Banners.tsx` | transient bust/leg_won/game_won banners |
| `src/components/ConnectionBadge.tsx` | live connection status |
| `src/src-tauri/{tauri.conf.json,Cargo.toml,src/main.rs}` | Tauri scaffold (flagged: needs Rust) |
| `src/**/*.test.tsx`, `src/**/*.test.ts` | Vitest tests |

Each board file has one responsibility (one game mode). The store and hook are independently testable.

---

## 5. Data Contracts (TS mirror)

Inbound events match SP1/SP2: `connection_state{state,device,rssi}`, `dart_hit{...}`,
`game_state{state:GameState}`, `bust{player,...}`, `leg_won{player,legs,sets}`, `game_won{player}`,
`error{category,message}`. `GameState` mirrors `game/models.py` (mode, status, players, active_index,
visit, legs, mode_view, stats). Outbound commands match `game/commands.py`: `start_game`,
`next_player`, `record_miss`, `undo`, `correct_last{bed}`, `end_game`.

---

## 6. Testing

- **store.test.ts** — applying a `game_state` event updates `gameState`; banners ring-buffer caps; connection transitions.
- **useGranbridgeSocket.test.ts** — with a mock WebSocket: on `game_state` message the store updates; `send()` serializes a command; reconnect scheduled on close.
- **X01Board.test.tsx / CricketBoard.test.tsx** — render a sample `mode_view`, assert scores/marks/checkout shown; active player highlighted.
- **Setup.test.tsx** — selecting X01 + 2 players + submit calls `send` with a well-formed `start_game`.
- Run via `npm test` (Vitest, jsdom). CI-safe (no real socket).

---

## 7. Integration & No-Rework Note

Purely additive: a new `ui/` tree. The bridge is unchanged; the UI is one more WebSocket client of
the existing contract (the score overlays remain valid alongside it). README gains a "Desktop UI" section.

---

## 8. Out of Scope (later)

Native Tauri build (needs Rust), match history/stats persistence, settings UI for the bridge,
heatmaps/timelines (data is available via `stats`/`hits` but rich viz is deferred), i18n, auth.
