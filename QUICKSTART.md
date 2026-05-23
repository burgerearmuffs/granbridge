# GRANBRIDGE — Quick Start

Turn your GRANBOARD into a connected scoreboard: live scoring, rich graphics, OBS overlays, and
online play with a friend over camera + mic. This is the 5-minute version — see [`README.md`](README.md)
for the full details.

> **Latest download:** https://github.com/burgerearmuffs/granbridge/releases/latest
> Windows 10/11 (x64). The board-validated scoring map ships built in, so most boards work out of the box.

---

## 1. Get it

From the [latest release](https://github.com/burgerearmuffs/granbridge/releases/latest), pick one:

| Download | What it is | Use when |
|---|---|---|
| **`GRANBRIDGE_*_x64_en-US.msi`** | MSI installer (recommended) | You want a normal installed app + Start-menu entry. |
| **`GRANBRIDGE_*_x64-setup.exe`** | NSIS setup | Same, alternative installer. |
| **`granbridge-*-portable-win64.zip`** | No-install portable folder | You'd rather not install — unzip and run. |

## 2. Run it

- **Installed (MSI/NSIS):** launch **GRANBRIDGE** from the Start menu. A window opens showing the UI.
- **Portable:** unzip, then double-click **`granbridge.exe`** in the `granbridge\` folder. It serves the
  UI and opens it in your browser automatically.

Either way it starts the bridge (UI at `http://127.0.0.1:8080`) and begins looking for your board.

## 3. Connect your board

1. **Wake the GRANBOARD** (throw a dart or press it) so it's advertising over Bluetooth, and make sure
   Bluetooth is on.
2. GRANBRIDGE auto-discovers and connects — the connection badge turns **green**.
3. **Calibration (only if needed):** the standard 20×4 + bull map is built in and validated, so most
   boards score correctly immediately. If a segment reads wrong, run a one-time calibration from a
   terminal:
   ```
   granbridge calibrate
   ```
   (Installed app: run the bundled `granbridge.exe calibrate`. Portable: `granbridge.exe calibrate` in
   the unzipped folder.) Calibration is saved under `%LOCALAPPDATA%\granbridge`.

> The board has no out-zone sensors, so **misses send nothing** — use the **Record miss** control for a
> missed dart.

## 4. Play a local game

1. Go to the **Live** tab → **New Game**.
2. Pick a **mode** — X01 (301/501/701), Cricket, Around the Clock, Free Play, **Count-Up**, or
   **Medley** (a best-of-3 of X01 → Cricket → Count-Up).
3. Enter player names (comma-separated) and any mode options, then **Start Game**.
4. Throw — scores, checkout hints, sounds, and celebrations update live. Use the on-screen controls for
   **next player**, **record miss**, **undo**, and **correct misread**.

## 5. Play online with a friend (multiplayer)

Two people, each on their own board + their own GRANBRIDGE, play one shared match with video/voice.

1. Both open the **Multiplayer** tab.
2. Set your **display name** + pick an avatar color in the **Profile** tab (optional).
3. Both enter the **same Room ID + password** and the **Broker URL**, then **Join**. You'll see each
   other's camera tiles and an opponent stat card.
4. The **host** (shown automatically) picks a mode and clicks **Start match**; the other player sees
   "waiting for the host." Both boards then drive the one shared game — the host's engine is the
   source of truth.

> **You need a reachable broker** for the internet path (rooms + signaling) and, for camera/voice across
> home networks, a **TURN server**. See [`server/`](server) for the Dockerized broker + coturn and the
> TOWER deploy notes. On a LAN you can run the broker locally (`granbridge relay` / the `server/` broker).

## 6. OBS overlays (optional)

Browser-source overlays (scoreboard, checkout, throw, stats, lower-third) are served at
`http://127.0.0.1:8080/overlays/`. Add one as a Browser Source in OBS. Add `?kiosk` to the main UI URL
for a clean full-screen scoreboard.

## 7. Where your data lives

Everything writable is under **`%LOCALAPPDATA%\granbridge`**:
- `history.db` — match history + career stats
- `segment_map.overrides.json` — your calibration (if any)
- `logs\` — decoded-event logs and diagnostics

## 8. Troubleshooting

- **Board won't connect:** wake it (throw/press), confirm Bluetooth is on, and that no other app holds
  the board. The badge shows the connection state.
- **UI didn't open:** browse to `http://127.0.0.1:8080` manually. If the port is busy, set
  `GRANBRIDGE_HTTP_PORT` / `GRANBRIDGE_WS_PORT` before launching.
- **A segment scores wrong:** run `granbridge calibrate`.
- **Multiplayer won't connect:** check the Room ID/password match, the Broker URL is reachable, and
  (for cross-network A/V) that a TURN server is configured.

## More
- Full docs: [`README.md`](README.md)
- Multiplayer manual test / how remote sync works: [`docs/MANUAL-E2E-mp3.md`](docs/MANUAL-E2E-mp3.md)
- Self-hosting the broker: [`server/`](server)
