import hashlib, hmac, struct
import smoke

MAGIC = 0x2112A442


def test_long_term_key_format():
    # key = MD5("username:realm:credential")
    assert smoke._long_term_key("u", "r", "p") == hashlib.md5(b"u:r:p").digest()


def test_authed_allocate_structure_and_integrity():
    key = b"\x11" * 16
    txn = b"\x00" * 12
    msg = smoke._build_authed_allocate(txn, "1779", b"darts.aventador.io", b"nonceval", key)
    mtype, mlen = struct.unpack(">HH", msg[:4])
    assert mtype == 0x0003                    # Allocate Request
    assert mlen == len(msg) - 20              # header length covers ALL attrs incl. MESSAGE-INTEGRITY
    # MESSAGE-INTEGRITY is the last attribute (24 bytes: 4 header + 20 HMAC)
    at, al = struct.unpack(">HH", msg[-24:-20])
    assert at == 0x0008 and al == 20
    # the length-trick: HMAC-SHA1 over everything-before-the-MI-attr must equal the MI value
    assert msg[-20:] == hmac.new(key, msg[:-24], hashlib.sha1).digest()
    # required attributes present
    assert smoke._get_attr(msg, 0x0006) == b"1779"               # USERNAME
    assert smoke._get_attr(msg, 0x0014) == b"darts.aventador.io" # REALM
    assert smoke._get_attr(msg, 0x0015) == b"nonceval"           # NONCE
    assert smoke._get_attr(msg, 0x0019) == b"\x11\x00\x00\x00"   # REQUESTED-TRANSPORT (UDP)


def test_get_attr_extracts_realm_and_nonce():
    body = smoke._stun_attr(0x0014, b"test.local") + smoke._stun_attr(0x0015, b"abc123")
    resp = struct.pack(">HHI", 0x0113, len(body), MAGIC) + b"\x00" * 12 + body  # Allocate Error (401)
    assert smoke._get_attr(resp, 0x0014) == b"test.local"
    assert smoke._get_attr(resp, 0x0015) == b"abc123"
    assert smoke._get_attr(resp, 0x0099) is None


def test_parse_xor_relayed_address():
    ip_int, port = 0x0A141E28, 49152                  # 10.20.30.40:49152
    xport = port ^ (MAGIC >> 16)
    xaddr = ip_int ^ MAGIC
    val = struct.pack(">BBHI", 0x00, 0x01, xport, xaddr)
    attr = struct.pack(">HH", 0x0016, len(val)) + val  # XOR-RELAYED-ADDRESS
    resp = struct.pack(">HHI", 0x0103, len(attr), MAGIC) + b"\x00" * 12 + attr  # Allocate Success
    assert smoke.parse_xor_mapped_address(resp, 0x0016) == ("10.20.30.40", 49152)
