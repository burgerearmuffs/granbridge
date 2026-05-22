from __future__ import annotations

import asyncio
from pathlib import Path

import typer

from granbridge.api.ws_server import WebSocketServer
from granbridge.ble.bleak_transport import BleakTransport
from granbridge.ble.connection import ConnectionManager
from granbridge.ble.transport import ReplayTransport
from granbridge.config import Settings
from granbridge.core.bus import EventBus
from granbridge.logging_setup import configure_logging
from granbridge.protocol.segment_map import SegmentMap

app = typer.Typer(help="GRANBRIDGE — GRANBOARD BLE bridge")


@app.command()
def scan(timeout: float = 5.0) -> None:
    """Scan for nearby GRANBOARD devices and print them."""
    settings = Settings()

    async def _run() -> None:
        devices = await BleakTransport().scan(settings.board_name_prefix, timeout)
        if not devices:
            typer.echo("No GRANBOARD found.")
            return
        for d in devices:
            typer.echo(f"{d.name}  {d.address}  rssi={d.rssi}")

    asyncio.run(_run())


@app.command()
def serve() -> None:
    """Connect to the board and stream events over WebSocket."""
    settings = Settings()
    configure_logging(settings.log_dir)

    async def _run() -> None:
        bus = EventBus()
        segment_map = SegmentMap.load(settings.overrides_path)
        mgr = ConnectionManager(
            transport=BleakTransport(),
            bus=bus,
            name_prefix=settings.board_name_prefix,
            service_uuid=settings.vendor_service_uuid,
            backoff_base=settings.backoff_base,
            backoff_cap=settings.backoff_cap,
            heartbeat_timeout=settings.heartbeat_timeout,
            segment_map=segment_map,
        )
        server = WebSocketServer(bus, settings.ws_host, settings.ws_port)
        await server.start()
        typer.echo(f"Serving events on ws://{settings.ws_host}:{settings.ws_port}")
        await mgr.run()

    asyncio.run(_run())


@app.command()
def replay(session: Path, ws: bool = True) -> None:
    """Replay a recorded session file (one raw frame per line) through the stack."""
    settings = Settings()
    frames = [line.strip().encode() for line in Path(session).read_text().splitlines() if line.strip()]

    async def _run() -> None:
        bus = EventBus()
        transport = ReplayTransport(frames=frames, interval_s=0.3)
        mgr = ConnectionManager(
            transport=transport,
            bus=bus,
            name_prefix="REPLAY",
            service_uuid="svc",
            backoff_base=0.0,
            backoff_cap=0.0,
            segment_map=SegmentMap.load(settings.overrides_path),
        )
        server = WebSocketServer(bus, settings.ws_host, settings.ws_port) if ws else None
        if server:
            await server.start()
        run_task = asyncio.create_task(mgr.run())
        await mgr.wait_connected(timeout=5)
        await transport.play()
        mgr.stop()
        await run_task
        if server:
            await server.stop()

    asyncio.run(_run())


@app.command()
def calibrate() -> None:
    """Interactively map physical beds to raw frames (writes overrides JSON)."""
    from granbridge.protocol.calibrate_flow import run_calibration

    run_calibration(Settings())
