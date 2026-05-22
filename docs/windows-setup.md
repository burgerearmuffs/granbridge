# Windows 11 Setup

## Bluetooth pairing
1. Power on the GRANBOARD (2x AA). It advertises a name starting with `GRAN`.
2. Windows Settings → Bluetooth & devices → Add device → Bluetooth. Pair the board.
   (GRANBOARD 3s uses BLE 5.0 and usually connects without a PIN.)
3. Run `.venv\Scripts\granbridge scan` to confirm GRANBRIDGE can see it.

## Python
- Built and tested on Python 3.14 with Bleak 3.0.2. Python 3.12+ is supported.
- If a dependency lacks a wheel for your interpreter, create the venv with
  `py -3.12 -m venv .venv` and reinstall.

## Networking
- The WebSocket server binds to `127.0.0.1:8787` (localhost only) by default — no
  inbound firewall rule is needed. Override with `GRANBRIDGE_WS_HOST` /
  `GRANBRIDGE_WS_PORT` env vars if you expose it on the LAN (then add a rule).

## Troubleshooting
- **Board not found:** make sure it's awake (press a segment); it sleeps to save battery.
- **Drops after sleep:** expected — the bridge auto-reconnects with backoff.
- **Adapter glitches:** toggle Bluetooth off/on in Windows Settings; the bridge recovers.
- **Wrong scores:** run `granbridge calibrate` to (re)map beds for your specific board.
