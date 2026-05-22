# GRANBRIDGE — Sub-project 5: "OBS Overlay Suite" (Design Spec)

- **Date:** 2026-05-21 · Self-approved under the autonomous-build mandate.
- **Depends on:** SP1 (WS event feed) + SP2 (`game_state`/transition events).

## 1. Goal & Success Criteria
A set of transparent, OBS-ready browser-source overlays driven by the WebSocket, plus a launcher
page documenting them.

**Done when:** each overlay is a standalone transparent HTML file that connects to
`ws://127.0.0.1:8787` (auto-reconnect via a shared helper), renders its slice of live state with
**safe DOM only (no `innerHTML`)**, and degrades gracefully when no game is running. A launcher page
lists all overlays with OBS setup notes. Python asset tests verify each overlay's contract.

## 2. Design
- **`overlay/common.js`** — a tiny shared helper `connectGranbridge(onEvent, {port})` that owns the
  WebSocket lifecycle (connect, reconnect with backoff, JSON parse, dispatch to `onEvent`). DRYs the
  five overlays. Loaded via relative `<script src="common.js">` (works under file:// and when served).
- **Overlays** (each transparent, fixed-position, large type, TV-safe):
  - `scoreboard.html` — players + scores; X01 remaining or Cricket points; active highlight.
  - `checkout.html` — big X01 checkout suggestion ("OUT: T20 T20 BULL"); hidden when none.
  - `throw.html` — animates the latest dart (`dart_hit`): bed + score pops/fades.
  - `stats.html` — per-player 3-dart average + darts thrown (from `game_state.state.stats`).
  - `lower-third.html` — "Now playing: <mode>" + player names (from `game_started`/`game_state`).
  - `launcher.html` — index listing the overlays, their URLs, and OBS Browser-Source instructions.
- Existing `index.html`, `game.html`, `broadcast.html` (SP1/SP2/SP3) remain valid and are listed too.

## 3. Testing
Python asset tests (`tests/overlay/test_overlays.py`): for each overlay assert it (a) references
`common.js` or a WebSocket, (b) references the event type(s) it consumes, (c) contains no
`innerHTML`. Launcher lists each overlay filename.

## 4. Out of Scope
Overlay theming UI, drag-to-arrange editor, alert sound packs (a sound overlay is a follow-up via
the same WS helper), per-overlay config panels.
