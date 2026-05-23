"""Entry point: python -m granbridge_broker

Builds the broker from environment config (see config.from_env), logs to stdout,
and shuts down cleanly on SIGTERM/SIGINT so `docker stop` is fast.
"""
import asyncio
import logging
import signal

from granbridge_broker.broker import BrokerServer
from granbridge_broker.config import from_env


async def _main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    log = logging.getLogger("granbridge.broker")
    cfg = from_env()
    server = BrokerServer(
        cfg.host,
        cfg.port,
        cfg.room_size_cap,
        max_rooms=cfg.max_rooms,
        max_size=cfg.max_size,
        allowed_origins=cfg.allowed_origins,
        turn_secret=cfg.turn_secret,
        turn_domain=cfg.turn_domain,
        turn_ttl=cfg.turn_ttl,
    )
    loop = asyncio.get_running_loop()
    stop = loop.create_future()

    def _request_stop() -> None:
        if not stop.done():
            stop.set_result(None)

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except NotImplementedError:
            # Windows dev: rely on KeyboardInterrupt below
            pass

    await server.start()
    log.info(
        "broker listening host=%s port=%s domain=%s max_rooms=%s origins=%s",
        cfg.host, cfg.port, cfg.turn_domain, cfg.max_rooms, cfg.allowed_origins,
    )

    try:
        await stop
    finally:
        log.info("shutting down")
        await server.stop()


if __name__ == "__main__":
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        pass  # graceful stop already ran in _main's finally; just silence the traceback
