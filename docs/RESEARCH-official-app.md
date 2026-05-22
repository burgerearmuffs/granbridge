# Research: The Official GRANBOARD App (competitive analysis)

- **Date:** 2026-05-22. Sources: Gran Darts official site/store/support, App Store/Play listings,
  community forums (dartsnutz), KrakenDarts. Caveat: synthesized from public listings, changelogs,
  support docs, and reviews — not a hands-on teardown. Treat feature details as ~accurate, not exact.
- **Why:** the user's MVP target = "basically the GRANBOARD app as it is today, with a foundation to
  make it better." This maps their features → our status → parity gaps → our differentiators.

## The landscape
- **GranBoard App** (`jp.luxza.granboard`, iOS + Android) — the long-standing soft-tip app for
  GRANBOARD 3s / dash. The thing to reach parity with.
- **GranDarts App** (new, Apr 2025) — a from-scratch app originally for **GRAN EYE** (steel-tip camera
  auto-scoring); GRANBOARD 3s/dash **now also work with it**. Gran Darts is clearly consolidating here.
  2026 additions: a **PIRATES** practice game, a **pre-match video greeting**, opponent dart-hit sound.
  ⚠️ **Data is siloed**: ranks/stats/history do NOT transfer between the GranBoard app and GranDarts app.
- **GRANCAM** — a camera accessory; **online tournaments** at online.gran-darts.com.

## Feature inventory (official app)
- **Game modes:** 01 (301/501/701/901/1101/1501), Cricket (multiple variants), **Medley** (best-of /
  multi-format matches), **Count-Up**, **Animal Battle** (AI opponents), **party games**, practice
  games (+ PIRATES). Customizable rules.
- **Online multiplayer:** play worldwide; **AI skill-based matchmaking**; **ranking system +
  leaderboards**; friend/private matches; a redesigned **quick-match lobby**; **online tournaments**.
- **In-match video:** uses the device camera for **video calls during online matches**; display option
  "always show opponent" vs "show throwing player"; pre-match video greeting (GranDarts).
- **Personalization / social:** custom **avatar**, **dart design**, **entrance theme**; share achievements.
- **Stats:** performance tracking & analysis, progress/history, ranks.
- **Hardware UX:** auto-connect over Bluetooth; hit effects + LED feedback.
- **Platforms:** iOS + Android only. **No official desktop/PC app** (PC only via Android emulators).
- **Monetization:** paid app / in-app elements (reviews grumble the price feels steep for the quality).

## What it does WELL (their moat)
1. **A large, established online player base** — the single hardest thing to replicate; the network is the value.
2. **Full online stack:** matchmaking + ranking + leaderboards + tournaments + in-match video — a real
   premium remote experience already exists.
3. **Breadth of modes** incl. AI/Animal Battle and party games.
4. **Social/personalization layer** (avatars, entrance themes) that makes online play feel like a game.
5. Turnkey Bluetooth auto-connect with board LED/hit effects.

## What it does POORLY (our wedge)
1. **Bluetooth reliability** — the #1 complaint: drops "almost after every throw" for some, hit-effect/LED
   lag, a 3S hat-trick disconnect bug requiring a reboot, pairing failures. (Reliability is *our* stated #1 priority.)
2. **No desktop / no TV/big-screen experience** — mobile-only. This is our entire niche.
3. **No streaming/OBS integration, no overlays, no plugins/automation/API** — closed to the maker/streamer scene.
4. **Data silos & lock-in** — stats/ranks don't transfer between their own apps; no export, no self-host, no API; subscription/price friction.
5. **Dated/clunky UI** sentiment; basic-ish stats; occasional **segment misreads** (e.g. bull → "out dart").

## Parity gap analysis vs GRANBRIDGE (for "MVP = their app today")
| Capability | Official | GRANBRIDGE today | Gap to close for MVP parity |
|---|---|---|---|
| Board connect (BLE) | ✅ (but flaky) | ✅ + reliability-first (reconnect/watchdog) — **unvalidated on HW** | validate on hardware (Step 1) |
| 01 / Cricket | ✅ | ✅ | — |
| **Count-Up** | ✅ | ❌ | **add** (easy mode) |
| **Medley / best-of formats** | ✅ | ◐ (legs+sets exist) | wire a medley/match config |
| Party / **AI (Animal) battle** | ✅ | ❌ | add a simple AI/bot opponent + a party mode (post-MVP-ok) |
| Online play | ✅ matchmaking+ranking | ◐ broker built (rooms+password) | **MP-2/3** (WebRTC + sync). NOTE: user chose room+password over matchmaking — deliberate divergence |
| **In-match video/voice** | ✅ | ❌ (player-cams are one-way OBS only) | **MP-2** (WebRTC A/V) — table-stakes for parity, not optional |
| Profiles / avatars / entrance themes | ✅ | ◐ local stats only | **MP-4** profiles + personalization |
| Ranking / leaderboards / tournaments | ✅ | ❌ | post-MVP (needs the online backend + accounts) |
| Stats / history | ✅ basic | ✅ (history DB, heatmap) — arguably deeper | — / advantage |
| Desktop / TV UX | ❌ | ✅ (Tauri app, kiosk) | **our differentiator** |
| OBS / overlays / streaming | ❌ | ✅ | **our differentiator** |
| Plugins / MQTT / home-automation | ❌ | ✅ | **our differentiator** |
| Self-hosted / own-your-data / open | ❌ | ✅ (self-hosted broker, local DB, export-able) | **our differentiator** |

## Takeaways for the MVP & roadmap
1. **In-match video/voice is parity, not polish.** The official app's online hook *is* video. Our MP-2
   (WebRTC A/V) is required for "their app today," confirming the multiplayer-first reframe.
2. **Reliability is the headline differentiator** — their worst pain (BLE drops) is our #1 design value.
   Step 1 hardware validation + the reconnect/watchdog work is competitively important, not just hygiene.
3. **Close the easy mode gaps for parity:** add **Count-Up** and a **Medley/best-of match** config (small,
   high-value); a simple **bot/AI opponent** + **party mode** can be fast-follow.
4. **Personalization matters online:** profiles need avatar + (stretch) entrance theme to feel premium.
5. **Lean into what they can't/won't do:** desktop+TV, OBS/streaming, plugins/automation, **self-hosted &
   own-your-data** (their data-silo lock-in is a real grievance — we offer export + no subscription).
6. **Deliberate divergence:** user wants **room+password pairing, not matchmaking/ranking.** That's a
   simpler, friends-first model — fine for MVP; ranking/tournaments are a later, backend-heavy option.

## Suggested additions to the target list (queued)
- `Count-Up` game mode; `Medley`/best-of match configurator; simple `BotOpponent` (AI) + party mode.
- Profile **avatar** + optional **entrance theme/animation** (ties into the celebration/overlay system).
- Stats export (CSV/JSON) as an explicit "own your data" feature.
