"""Live GATT diagnostic for a GRANBOARD.

Connects to the board, prints the FULL services/characteristics table, subscribes to
EVERY notify/indicate characteristic, and streams all raw notifications — with NO
heartbeat watchdog and NO reconnect loop, so the connection stays up while you throw.

This is how we find which characteristic carries dart-hit data (and whether the board
needs a handshake to start streaming).

Run from the repo root:
    & ".venv\\Scripts\\python.exe" tools\\gatt_dump.py

Throw a few darts, then press Ctrl-C. Output is mirrored to logs\\gatt_dump.log.
"""
from __future__ import annotations

import asyncio
import datetime
from pathlib import Path

from bleak import BleakClient, BleakScanner

NAME_PREFIX = "GRAN"
LOG = Path("logs") / "gatt_dump.log"


def emit(line: str = "") -> None:
    print(line, flush=True)
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def _on_notify(char_uuid: str):
    def cb(_sender, data: bytearray) -> None:
        b = bytes(data)
        ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
        emit(f"  [{ts}] NOTIFY {char_uuid}  hex={b.hex()}  ascii={b.decode('ascii', 'replace')!r}")
    return cb


async def main() -> None:
    emit(f"\n==== gatt_dump {datetime.datetime.now().isoformat()} ====")
    emit("Scanning for a board whose name starts with 'GRAN' (6s)...")
    found = await BleakScanner.discover(timeout=6.0, return_adv=True)
    target = None
    for dev, adv in found.values():
        name = dev.name or adv.local_name or ""
        if name.startswith(NAME_PREFIX):
            target = dev
            emit(f"Found: {name}  @ {dev.address}  rssi={adv.rssi}")
            break
    if target is None:
        emit("No GRANBOARD found. Power-cycle the board (off/on), make sure no other app/phone "
             "is connected to it, then retry.")
        return

    def on_disconnect(_c: object) -> None:
        emit("!! board disconnected us")

    client = BleakClient(target, disconnected_callback=on_disconnect)
    emit("Connecting...")
    await client.connect()
    emit(f"Connected: {client.is_connected}")
    emit("\n--- GATT TABLE ---")
    notify_chars: list[str] = []
    write_chars: list[str] = []
    for service in client.services:
        emit(f"service {service.uuid}  ({service.description})")
        for ch in service.characteristics:
            emit(f"  char {ch.uuid}  props={sorted(ch.properties)}")
            if "notify" in ch.properties or "indicate" in ch.properties:
                notify_chars.append(ch.uuid)
            if "write" in ch.properties or "write-without-response" in ch.properties:
                write_chars.append(ch.uuid)

    emit(f"\nnotify/indicate chars: {notify_chars}")
    emit(f"write chars: {write_chars}")
    emit(f"\nSubscribing to {len(notify_chars)} notify/indicate characteristic(s). "
         "THROW DARTS NOW — watch which characteristic prints. Ctrl-C to stop.\n")
    for uuid in notify_chars:
        try:
            await client.start_notify(uuid, _on_notify(uuid))
        except Exception as exc:  # noqa: BLE001
            emit(f"  (could not subscribe {uuid}: {exc})")

    try:
        while client.is_connected:
            await asyncio.sleep(1.0)
    finally:
        emit("Disconnecting.")
        try:
            await client.disconnect()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        emit("Stopped.")
