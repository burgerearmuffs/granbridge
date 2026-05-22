from __future__ import annotations

from typing import Optional

from bleak import BleakClient, BleakScanner

from granbridge.ble.transport import DeviceInfo, DisconnectCallback, NotifyCallback


class BleakTransport:
    """Real Windows (WinRT) BLE transport backed by Bleak."""

    def __init__(self) -> None:
        self._client: Optional[BleakClient] = None
        self._disc_cb: Optional[DisconnectCallback] = None

    async def scan(self, name_prefix: str, timeout: float) -> list[DeviceInfo]:
        found = await BleakScanner.discover(timeout=timeout, return_adv=True)
        results: list[DeviceInfo] = []
        for device, adv in found.values():
            name = device.name or adv.local_name or ""
            if name.startswith(name_prefix):
                results.append(DeviceInfo(name=name, address=device.address, rssi=adv.rssi))
        return results

    async def connect(self, address: str) -> None:
        self._client = BleakClient(address, disconnected_callback=self._on_bleak_disconnect)
        await self._client.connect()

    async def enumerate_notify_chars(self, service_uuid: str) -> list[str]:
        assert self._client is not None
        chars: list[str] = []
        for service in self._client.services:
            if service.uuid.lower() != service_uuid.lower():
                continue
            for ch in service.characteristics:
                if "notify" in ch.properties:
                    chars.append(ch.uuid)
        return chars

    async def subscribe(self, char_uuid: str, callback: NotifyCallback) -> None:
        assert self._client is not None
        await self._client.start_notify(char_uuid, lambda _sender, data: callback(bytes(data)))

    async def write(self, char_uuid: str, data: bytes) -> None:
        assert self._client is not None
        await self._client.write_gatt_char(char_uuid, data, response=False)

    async def disconnect(self) -> None:
        if self._client is not None:
            await self._client.disconnect()
            self._client = None

    def on_disconnect(self, callback: DisconnectCallback) -> None:
        self._disc_cb = callback

    def _on_bleak_disconnect(self, _client: object) -> None:
        if self._disc_cb is not None:
            self._disc_cb()

    @property
    def is_connected(self) -> bool:
        return self._client is not None and self._client.is_connected
