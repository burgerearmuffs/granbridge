from __future__ import annotations

import asyncio
import random

import structlog

from granbridge.ble.transport import Transport
from granbridge.core.bus import EventBus
from granbridge.events.models import ConnectionState, ErrorEvent
from granbridge.protocol.decoder import Decoder
from granbridge.protocol.frames import FrameAssembler
from granbridge.protocol.segment_map import SegmentMap

log = structlog.get_logger(__name__)


class ConnectionManager:
    """Owns the BLE lifecycle: scan -> connect -> enumerate -> subscribe, with
    exponential-backoff reconnect and a heartbeat watchdog. Decoded events and
    connection-state changes are published to the bus."""

    def __init__(
        self,
        transport: Transport,
        bus: EventBus,
        name_prefix: str,
        service_uuid: str,
        backoff_base: float = 0.5,
        backoff_cap: float = 30.0,
        heartbeat_timeout: float = 20.0,
        segment_map: SegmentMap | None = None,
    ) -> None:
        self._t = transport
        self._bus = bus
        self._name_prefix = name_prefix
        self._service_uuid = service_uuid
        self._backoff_base = backoff_base
        self._backoff_cap = backoff_cap
        self._heartbeat_timeout = heartbeat_timeout
        self._decoder = Decoder(segment_map or SegmentMap())
        self._assembler = FrameAssembler()
        self._stop = asyncio.Event()
        self._connected = asyncio.Event()
        self._conn_generation = 0          # bumped each time _connected becomes True
        self._last_frame_at = 0.0
        self._loop_queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._stop_serving = asyncio.Event()

    def stop(self) -> None:
        self._stop.set()

    async def wait_connected(self, timeout: float) -> None:
        """Wait until a *new* live connection is active.

        We capture the current generation before waiting. If the event is
        already set but the caller is racing a disconnect, the generation check
        ensures we block until the next genuine connection cycle completes.
        """
        gen_at_call = self._conn_generation
        # Yield once so any pending same-tick callbacks (e.g. clear from drop)
        # have a chance to run.
        await asyncio.sleep(0)
        if self._connected.is_set() and self._conn_generation > gen_at_call:
            return
        # Wait until _connected becomes True with a generation that's newer.
        async def _wait() -> None:
            while True:
                await self._connected.wait()
                if self._conn_generation > gen_at_call:
                    return
                # Still old generation; wait for it to cycle
                self._connected.clear()
                await self._connected.wait()

        await asyncio.wait_for(_wait(), timeout=timeout)

    async def run(self) -> None:
        attempt = 0
        while not self._stop.is_set():
            try:
                await self._connect_once()
                attempt = 0
                await self._serve_until_disconnect()
            except Exception as exc:
                await self._bus.publish(
                    ErrorEvent(category="ble", message=str(exc), recoverable=True)
                )
            finally:
                self._connected.clear()
            if self._stop.is_set():
                break
            await self._publish_state("reconnecting")
            await asyncio.sleep(self._backoff(attempt))
            attempt += 1
        await self._safe_disconnect()
        await self._publish_state("disconnected")

    async def _connect_once(self) -> None:
        await self._publish_state("scanning")
        devices = await self._t.scan(self._name_prefix, timeout=5.0)
        if not devices:
            raise RuntimeError(f"no device with name prefix {self._name_prefix!r}")
        target = devices[0]
        await self._publish_state("connecting", device=target.name, rssi=target.rssi)
        await self._t.connect(target.address)
        chars = await self._t.enumerate_notify_chars(self._service_uuid)
        if not chars:
            raise RuntimeError("no notify characteristic on vendor service")
        loop = asyncio.get_running_loop()
        self._stop_serving = asyncio.Event()
        self._assembler.reset()  # drop any partial frame / dedup state from a prior session
        await self._t.subscribe(
            chars[0],
            lambda data: loop.call_soon_threadsafe(self._loop_queue.put_nowait, data),
        )
        self._t.on_disconnect(lambda: loop.call_soon_threadsafe(self._stop_serving.set))
        self._last_frame_at = loop.time()
        self._conn_generation += 1
        self._connected.set()
        await self._publish_state("connected", device=target.name, rssi=target.rssi)

    async def _serve_until_disconnect(self) -> None:
        loop = asyncio.get_running_loop()
        while not self._stop.is_set() and not self._stop_serving.is_set():
            # Race the queue get against the stop/disconnect signals and a
            # heartbeat deadline so we can exit promptly on any of them.
            get_task = asyncio.ensure_future(self._loop_queue.get())
            stop_task = asyncio.ensure_future(self._stop.wait())
            disc_task = asyncio.ensure_future(self._stop_serving.wait())
            try:
                done, pending = await asyncio.wait(
                    {get_task, stop_task, disc_task},
                    timeout=1.0,
                    return_when=asyncio.FIRST_COMPLETED,
                )
            finally:
                for t in (get_task, stop_task, disc_task):
                    if not t.done():
                        t.cancel()
                        try:
                            await t
                        except (asyncio.CancelledError, Exception):
                            pass

            if self._stop.is_set() or self._stop_serving.is_set():
                break

            if not done:
                # Timeout - check heartbeat
                if (loop.time() - self._last_frame_at) > self._heartbeat_timeout:
                    raise RuntimeError("heartbeat timeout: forcing reconnect")
                continue

            if get_task in done:
                data = get_task.result()
                self._last_frame_at = loop.time()
                for body in self._assembler.feed(data):
                    await self._bus.publish(self._decoder.decode(body))

    def _backoff(self, attempt: int) -> float:
        delay = min(self._backoff_cap, self._backoff_base * (2 ** attempt))
        return delay + random.uniform(0, self._backoff_base)

    async def _publish_state(self, state: str, device=None, rssi=None) -> None:
        await self._bus.publish(ConnectionState(state=state, device=device, rssi=rssi))

    async def _safe_disconnect(self) -> None:
        try:
            await self._t.disconnect()
        except Exception:
            pass
