"""Entry point: python -m granbridge_broker

Reads BROKER_HOST (default 0.0.0.0) and BROKER_PORT (default 8788) from the environment.
"""
import asyncio
import os

from granbridge_broker.broker import BrokerServer


async def _main() -> None:
    host = os.environ.get("BROKER_HOST", "0.0.0.0")
    port = int(os.environ.get("BROKER_PORT", "8788"))
    server = BrokerServer(host, port)
    await server.start()
    print(f"Broker listening on ws://{host}:{port}", flush=True)
    # Wait forever (until cancelled / Ctrl-C)
    await asyncio.get_running_loop().create_future()


if __name__ == "__main__":
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        pass
