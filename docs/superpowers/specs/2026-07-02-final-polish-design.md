# Final-Polish Pass + v0.1.9 — Design

**Date:** 2026-07-02
**Status:** Approved (user: "maximize the pass and cut the release")

## Goal

Close every pre-final gap identified in the 2026-07-01 review, then cut v0.1.9
per `docs/RELEASING.md` as the release candidate for the final version.

## Scope (one branch `feat/final-polish`, one PR, logical commits)

1. **Favicon + web icons.** Generate favicon.ico/PNGs from `tools/granbridge-icon.png`
   into `ui/public/`; add `<link rel="icon">` (+ apple-touch) to `ui/index.html`.
   Kills the 404 and the blank tab icon.
2. **Checkout memoization (FOLLOWUPS L3).** `game/checkout.py` rebuilds its
   ~33k-combination table on every `mode_view`. Cache the built table at module
   level (it is deterministic) and memoize per-remaining-score suggestions
   (bounded LRU). TDD; behavior identical.
3. **Stats export.** History view gains "Export JSON" / "Export CSV" buttons that
   download the locally stored match history (client-side Blob download, no new
   API). Pure serializers unit-tested; CSV covers per-match summary rows.
4. **Entrance themes.** Per-profile choice of a small set of self-generated
   walk-on styles (none | gold | teal | inferno). `tools/make_entrances.py`
   renders one short video clip per style (name-agnostic; the overlay draws the
   player name as text on top) + `make_sounds.py` gains one entrance fanfare per
   style. New `EntranceOverlay` plays theme video + fanfare when a game starts,
   sequentially per player with a theme, ≤4 s each, skippable by click, honors
   `granbridge.video` settings and reduced motion. Theme stored on the local
   profile (and included in profile sync payload only if the server schema
   already tolerates extra fields — otherwise local-only).
5. **Disconnect UX.** Review WS/bridge disconnect handling in the UI; ensure a
   clear persistent banner + automatic reconnect status; polish only, no
   protocol changes.
6. **FOLLOWUPS hygiene (bridge, non-BLE):** document `heartbeat`/`button` as
   reserved in the event contract; add `logs/raw_packets/` + `logs/crashes/`
   sinks; public `Engine.flush()` for `cli.py`; verify `overrides_path` default
   is out of the package tree.
7. **Accessibility:** keyboard/aria audit of Setup → LiveGame (labels, focus
   ring, overlay `role=status`); fix gaps found.
8. **Docs:** README/QUICKSTART sections for real sounds/videos, volume slider,
   drop-a-file customization, entrance themes, stats export.
9. **Verification:** full UI + Python suites, `vite build`, live dev-server
   smoke of new surfaces (favicon 200, export downloads, entrance overlay).
10. **Release v0.1.9** per RELEASING.md (bump tauri.conf + pyproject, icon step
    unchanged, PyInstaller + tauri build, hand-built latest.json, six assets,
    never --prerelease). Known gate: the updater key password is user-held —
    request it as a User-level env var at build time, read it explicitly.

## Out of scope

BLE/protocol/decoder/segment-map changes; server schema changes; TOWER
redeploy + 2-player test (user-owned).
