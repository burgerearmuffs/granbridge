import struct
import smoke

MAGIC = 0x2112A442


def test_build_binding_request_shape():
    pkt = smoke.build_stun_binding_request()
    assert len(pkt) == 20
    mtype, mlen, magic = struct.unpack(">HHI", pkt[:8])
    assert mtype == 0x0001 and mlen == 0 and magic == MAGIC
    assert len(pkt[8:20]) == 12  # transaction id


def test_parse_xor_mapped_address_roundtrip():
    # Build a Binding Response carrying XOR-MAPPED-ADDRESS for 1.2.3.4:1234
    ip_int = 0x01020304
    port = 1234
    xport = port ^ (MAGIC >> 16)
    xaddr = ip_int ^ MAGIC
    # XOR-MAPPED-ADDRESS value: reserved(B), family=IPv4(B), x-port(H), x-addr(I) = 8 bytes
    attr_val = struct.pack(">BBHI", 0x00, 0x01, xport, xaddr)
    attr = struct.pack(">HH", 0x0020, len(attr_val)) + attr_val
    txn = b"\x00" * 12
    resp = struct.pack(">HHI", 0x0101, len(attr), MAGIC) + txn + attr
    assert smoke.parse_xor_mapped_address(resp) == ("1.2.3.4", 1234)


def test_parse_returns_none_on_garbage():
    assert smoke.parse_xor_mapped_address(b"not-stun") is None


def test_check_stun_fails_on_unreachable_port():
    ok, detail = smoke.check_stun("127.0.0.1", 9, timeout=0.5)
    assert ok is False
    assert "stun" in detail.lower()
