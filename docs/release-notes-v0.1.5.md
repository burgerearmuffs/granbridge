# GRANBRIDGE v0.1.5 — Spectators, chat, turn clock, tournaments, Settings & onboarding

The biggest feature release since multiplayer launched. Update from the in-app banner, or grab the
installers below.

## New

- **🎟 Spectator mode** — friends can watch your online match live. Tick **Watch only** on the
  Multiplayer join form: no camera or mic needed, the board and score render in real time, and the
  players see a "👁 N watching" count. (Requires a broker running server-v0.3.0+.)
- **💬 In-match text chat** — chat with your opponent in the lobby and during the match
  (collapsible panel with an unread badge). Messages travel peer-to-peer on the same encrypted
  channel as game sync.
- **⏱ Turn clock** — the host can set a 30/45/60-second per-turn countdown that both players see.
  Advisory by design: it pressures, it never steals your turn.
- **🏆 Tournament night** — new Tournament tab: a local single-elimination bracket for 2–8 players
  on one board. Winners advance automatically as games finish; the bracket survives an app restart.
- **⚙ Settings tab** — pick your camera and microphone (with a live "Test camera" preview), edit
  the multiplayer server URL, clear local match history, and check for updates manually.
- **👋 First-run welcome** — a quick three-step setup on first launch: name + avatar, a tour of the
  app, and a prompt to back up the recovery key that protects your server-side career stats. The
  Profile tab now nudges until the key is backed up.

## Improved

- Camera/mic problems are no longer silent: if permission is denied (or another app holds the
  device) when joining a room, a clear notice explains what happened and how to fix it.
- The bridge connection now reconnects with exponential backoff instead of hammering once a second.
- Checkout suggestions compute instantly in long sessions (the 3-dart search is now cached).

## For self-hosters

- Broker **server-v0.3.0** adds the spectator role (`SPECTATOR_CAP` env, default 8). Spectators are
  invisible to host election, capped separately from players, and read-only at the server.
  Backwards-compatible with v0.1.4 clients.

---

**Full installers:** MSI (recommended) · NSIS setup · portable zip — see assets below.
Auto-update works on installs from v0.1.2 onward.
