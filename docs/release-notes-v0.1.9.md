# GRANBRIDGE v0.1.9

The sights-and-sounds release: real audio, real celebration videos, walk-on entrances — everything self-generated and yours to customize.

## New

- **Real sound effects** — dart-into-sisal thuds, crowd-roar fanfares for legs/games/180s, a soft checkout chime. Volume slider in the header; falls back to the built-in synthesiser per-sound if a file is missing.
- **Celebration videos** — full-screen GAME SHOT!, LEG!, 180 triple-flash, treble and bullseye moments. Muted-autoplay clips with procedural fallbacks.
- **Entrance themes** — pick *Gold Standard*, *Cool Runnings*, or *Inferno* on your Profile; starting a game plays your broadcast-style walk-on (video + fanfare, click or Esc to skip).
- **Export your data** — History tab now has **Export JSON** (complete history, stable `granbridge.history.v1` schema) and **Export CSV** (one row per throw).
- **Mid-game disconnect banner** — if the board drops or the bridge goes away during play, an unmissable banner says what's reconnecting and that your game state is safe.

## Improved

- App icon in the browser tab / web UI (favicon set).
- Video overlays fade in; richer backdrop; glassier surfaces.
- Accessibility: Escape skips the entrance, connection badge announces board state.
- Every clip is a drop-a-file replaceable asset — see `sounds/README.md` and `videos/README.md` in the app for filenames and specs; regeneration scripts ship in `tools/`.

## Fixed

- Profile bio sync no longer risks an unhandled rejection.
- Event contract: `heartbeat`/`button` documented as reserved.

**Suite:** 532 UI + 207 bridge tests green.

Full quick-start: the attached `QUICKSTART.md`.
