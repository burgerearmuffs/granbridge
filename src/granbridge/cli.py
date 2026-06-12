from __future__ import annotations

import asyncio
from pathlib import Path

import typer

from granbridge.api.static_server import StaticServer
from granbridge.api.ws_server import WebSocketServer
from granbridge.ble.bleak_transport import BleakTransport
from granbridge.ble.connection import ConnectionManager
from granbridge.ble.transport import ReplayTransport
from granbridge.config import Settings
from granbridge.core.bus import EventBus
from granbridge.game.commands import parse_command
from granbridge.game.engine import GameEngine
from granbridge.logging_setup import configure_logging
from granbridge.protocol.segment_map import SegmentMap
from granbridge.resources import static_dirs

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
def serve(
    open_browser: bool = typer.Option(False, "--open/--no-open", help="Open the UI in the default browser after starting."),
) -> None:
    """Connect to the board and stream events over WebSocket, serving the UI at /."""
    settings = Settings()
    configure_logging(settings.log_dir)

    async def _run() -> None:
        bus = EventBus()
        segment_map = SegmentMap.load(settings.overrides_path)
        engine = GameEngine(bus)

        def command_handler(payload: dict) -> None:
            try:
                engine.handle_command(parse_command(payload))
            except Exception:
                pass
            asyncio.create_task(engine.flush())

        mgr = ConnectionManager(
            transport=BleakTransport(), bus=bus,
            name_prefix=settings.board_name_prefix, service_uuid=settings.vendor_service_uuid,
            backoff_base=settings.backoff_base, backoff_cap=settings.backoff_cap,
            heartbeat_timeout=settings.heartbeat_timeout, segment_map=segment_map,
        )
        server = WebSocketServer(bus, settings.ws_host, settings.ws_port, command_handler=command_handler,
                                 http_port=settings.http_port, allowed_origins=settings.allowed_origins)
        await server.start()

        from granbridge.history import HistoryPlugin, HistoryStore

        store = HistoryStore(settings.history_db)

        ui_dir, overlay_dir = static_dirs()
        static = StaticServer(
            ui_dir,
            overlay_dir,
            settings.ws_host,
            settings.http_port,
            routes={
                "/api/history/recent": store.recent_games,
                "/api/history/stats": store.player_stats,
                "/api/history/heatmap": store.hit_counts,
                "/api/history/export/latest": store.export_latest_match,
            },
            post_routes={
                "/api/history/clear": store.clear_all,
            },
        )
        static.start()
        typer.echo(f"UI at http://{settings.ws_host}:{settings.http_port}  |  WS ws://{settings.ws_host}:{settings.ws_port}")
        if open_browser:
            import webbrowser
            webbrowser.open(f"http://{settings.ws_host}:{settings.http_port}")

        from granbridge.commentary.plugin import CommentaryPlugin
        from granbridge.integrations.manager import PluginManager
        from granbridge.integrations.plugins.event_log_plugin import EventLogPlugin
        from granbridge.integrations.registry import build_enabled
        plugins = build_enabled(settings)
        for _p in plugins:
            if isinstance(_p, CommentaryPlugin):
                _p.set_publish(bus.publish)
        plugins.append(HistoryPlugin({}, store))
        plugins.append(EventLogPlugin({"dir": settings.log_dir / "decoded_packets"}))
        plugin_mgr = PluginManager(bus, plugins)
        await asyncio.gather(mgr.run(), engine.attach(), plugin_mgr.run())

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


@app.command()
def relay(host: str = "127.0.0.1", port: int = 8788) -> None:
    """Run a local multiplayer relay server (room-based rebroadcast)."""
    import asyncio
    from granbridge.net.relay_server import RelayServer

    async def _run():
        server = RelayServer(host, port)
        await server.start()
        typer.echo(f"Relay on ws://{host}:{port} (join with ?room=<id>)")
        await asyncio.Event().wait()

    asyncio.run(_run())
