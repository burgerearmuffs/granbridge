from granbridge.ble.bleak_transport import BleakTransport
from granbridge.ble.transport import Transport


def test_bleak_transport_satisfies_protocol():
    t = BleakTransport()
    assert isinstance(t, Transport)  # runtime_checkable Protocol
    assert t.is_connected is False
