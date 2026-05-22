from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Callable, Optional, Protocol, runtime_checkable

NotifyCallback = Callable[[bytes], None]
DisconnectCallback = Callable[[], None]


@dataclass(frozen=True)
class DeviceInfo:
    name: str
    address: str
    rssi: Optional[int] = None


@runtime_checkable
class Transport(Protocol):
    """Abstract BLE transport. Real and fake implementations share this surface."""

    async def scan(self, name_prefix: str, timeout: float) -> list[DeviceInfo]: ...
    async def connect(self, address: str) -> None: ...
    async def enumerate_notify_chars(self, service_uuid: str) -> list[str]: ...
    async def subscribe(self, char_uuid: str, callback: NotifyCallback) -> None: ...
    async def write(self, char_uuid: str, data: bytes) -> None: ...
    async def disconnect(self) -> None: ...
    def on_disconnect(self, callback: DisconnectCallback) -> None: ...
    @property
    def is_connected(self) -> bool: ...


class FakeTransport:
    """Scriptable in-memory transport for tests. Push frames with `emit`,
    simulate a drop with `drop`."""

    def __init__(self, devices: Optional[list[DeviceInfo]] = None) -> None:
        self._devices = devices or []
        self._connected = False
        self._cb: Optional[NotifyCallback] = None
        self._disc_cb: Optional[DisconnectCallback] = None
        self.written: list[tuple[str, bytes]] = []

    async def scan(self, name_prefix: str, timeout: float) -> list[DeviceInfo]:
        return [d for d in self._devices if d.name.startswith(name_prefix)]

    async def connect(self, address: str) -> None:
        self._connected = True

    async def enumerate_notify_chars(self, service_uuid: str) -> list[str]:
        return ["fake-notify-char"]

    async def subscribe(self, char_uuid: str, callback: NotifyCallback) -> None:
        self._cb = callback

    async def write(self, char_uuid: str, data: bytes) -> None:
        self.written.append((char_uuid, data))

    async def disconnect(self) -> None:
        self._connected = False

    def on_disconnect(self, callback: DisconnectCallback) -> None:
        self._disc_cb = callback

    @property
    def is_connected(self) -> bool:
        return self._connected

    # --- test helpers ---
    def emit(self, data: bytes) -> None:
        if self._cb is not None:
            self._cb(data)

    def drop(self) -> None:
        self._connected = False
        if self._disc_cb is not None:
            self._disc_cb()


class ReplayTransport(FakeTransport):
    """Replays a recorded frame list through the same notify path."""

    def __init__(self, frames: list[bytes], interval_s: float = 0.0) -> None:
        super().__init__(devices=[DeviceInfo(name="REPLAY", address="replay")])
        self._frames = frames
        self._interval_s = interval_s

    async def play(self) -> None:
        for frame in self._frames:
            self.emit(frame)
            if self._interval_s:
                await asyncio.sleep(self._interval_s)
