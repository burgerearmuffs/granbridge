from __future__ import annotations

import asyncio

import typer

from granbridge.ble.bleak_transport import BleakTransport
from granbridge.config import Settings
from granbridge.events.models import Ring
from granbridge.protocol.frames import FrameAssembler
from granbridge.protocol.segment_map import SegmentMap

# Guided sequence: (prompt, ring, number)
_SEQUENCE: list[tuple[str, Ring, int | None]] = [
    ("single bull (25)", Ring.SBULL, 25),
    ("double bull (50)", Ring.DBULL, 50),
    *[(f"triple {n}", Ring.TRIPLE, n) for n in range(1, 21)],
]


def run_calibration(settings: Settings) -> None:
    sm = SegmentMap.load(settings.overrides_path)

    async def _run() -> None:
        transport = BleakTransport()
        devices = await transport.scan(settings.board_name_prefix, 5.0)
        if not devices:
            typer.echo("No board found.")
            return
        await transport.connect(devices[0].address)
        chars = await transport.enumerate_notify_chars(settings.vendor_service_uuid)
        assembler = FrameAssembler()
        queue: asyncio.Queue[str] = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def on_data(data: bytes) -> None:
            for body in assembler.feed(data):
                loop.call_soon_threadsafe(queue.put_nowait, body)

        await transport.subscribe(chars[0], on_data)
        for label, ring, number in _SEQUENCE:
            typer.echo(f"Throw at {label} (or Ctrl-C to stop)...")
            body = await queue.get()
            sm.set_override(body, ring, number)
            typer.echo(f"  recorded {body!r} -> {ring.value}{number}")
        sm.save(settings.overrides_path)
        await transport.disconnect()

    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        sm.save(settings.overrides_path)
        typer.echo("Saved partial calibration.")
