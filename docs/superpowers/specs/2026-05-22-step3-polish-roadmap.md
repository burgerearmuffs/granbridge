# GRANBRIDGE — Step 3: Depth & Polish (Roadmap)

- **Date:** 2026-05-22 · Self-approved under the autonomous-build mandate (2nd run).
- **Context:** Step 2 (packaging) done; user is validating Step 1 (hardware) for a few hours.
- **Run guardrails:** DO NOT touch `src/granbridge/protocol/`, `src/granbridge/ble/`, or the
  segment map/decoder (user is live-calibrating). Don't rebuild the packaged exe/installers. Stay in
  UI / audio / video / stats-persistence / config-logging-hardening lanes (all BLE-independent).

This roadmap decomposes Step 3 and **explicitly plans the user's named final-version priorities:
rich graphics, sound effects, and checkout videos.** Each sub-project gets its own spec→plan→build
→merge cycle; built in priority order, branch per sub-project, merged to `main`, pushed to GitHub.

## Sub-projects (priority order)

### SP-A · Rich graphics & theme (UI) — HIGHEST (named priority)
A real visual pass on the React UI:
- **SVG dartboard component** — renders the full board; highlights the last hit segment; doubles as
  the base for the heatmap (SP-D). Pure vector, no binary assets.
- **Theme system** — dark "arcade/Big-Picture" theme, large TV-safe type, accent colors, CSS
  variables; consistent across boards/controls/banners.
- **Animations** — score-pop on a hit, active-player transitions, leg/game-won celebration
  (confetti/glow via CSS/canvas), bust shake.
- **Real app icons** — replace the placeholder green squares with a generated GRANBRIDGE mark
  (SVG → multi-size PNG + .ico) for the window/installer.

### SP-B · Sound effects (UI) — named priority
A sound manager driven by WS events, **procedural by default (Web Audio synthesis — no binary
assets needed)** so it works offline immediately, with a **manifest** to swap in real audio files:
- Triggers: dart hit (pitch scales with score), treble/bull, bust, leg won, game won, **180**,
  checkout-available chime. Volume + mute in a settings panel; persisted to localStorage.
- `SoundManager` with a `SoundPack` interface: `SynthPack` (built-in, oscillator/noise-based) and
  `FilePack` (loads `/sounds/<name>.{mp3,ogg}` from a manifest — slots documented for the user).

### SP-C · Checkout videos (UI) — named priority
A full-screen video/celebration overlay triggered by checkout events:
- Triggers: **checkout available** (player on a finish — from `game_state.mode_view.checkout`),
  **checkout hit / game won**, big finishes (160+, 170).
- `CheckoutVideo` component plays a clip from a **manifest** (`/videos/<event>.mp4`) when present;
  otherwise renders a built-in **procedural celebration** (canvas/CSS animation) so it works with
  zero assets. Documented slots + a manifest so the user drops in real broadcast-style clips.
- Respects a "reduced motion / no video" setting.

### SP-D · Stats & history (backend + UI)
- **Persistence** (`granbridge/history/`): a SQLite store (stdlib `sqlite3`) recording games,
  players, throws, checkouts; a `HistoryPlugin` (SP4 plugin) subscribes to the bus and records.
  Config path under AppData (also fixes a FOLLOWUPS item).
- **API**: expose recent games / per-player stats over HTTP (JSON) from the static/HTTP server.
- **UI**: a History view (recent games, 3-dart averages, win rates) + a **heatmap** rendered on the
  SVG dartboard (SP-A) from aggregated hit data.

### SP-E · Hardening (FOLLOWUPS, non-BLE)
Bounded bus queues (drop-oldest), WS origin-guard before non-loopback bind, AppData config path,
headless JSON log sinks (raw/decoded/crashes), X01 "sets". Small, high-robustness, no BLE changes.

## Sequencing & parallelism
SP-A first (the dartboard + theme underpin C's celebration and D's heatmap). Then SP-B and SP-C
(both UI, can overlap on disjoint components). SP-D next (backend + UI). SP-E last / interleaved.
Within each, parallelize disjoint files per the subagent-driven skill.

## Asset reality (flagged for the user)
Graphics are vector/procedural (real, no external assets). Sound is **synthesized** by default —
fully working — with a manifest to drop in real audio files. Checkout **videos**: I can't produce
video files, so the system ships with a procedural celebration fallback + a documented manifest/slots
(`ui/public/videos/`) for the user's real clips. So all three are *functional now* and *upgradeable*
with real assets later.
