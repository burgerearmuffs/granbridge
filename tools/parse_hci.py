"""Parse an Android btsnoop_hci.log and print ATT notification/write payloads.

btsnoop format: 16-byte file header ('btsnoop\\0' + version + datalink), then
per-packet records: original_len(4) included_len(4) flags(4) drops(4)
timestamp(8) + packet data. We surface only the payload bytes + direction.
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

_FILE_HEADER = 16
_REC_HEADER = struct.Struct(">IIIIq")  # orig, incl, flags, drops, ts


def parse(path: Path) -> list[dict]:
    data = Path(path).read_bytes()
    if not data.startswith(b"btsnoop\x00"):
        raise ValueError("not a btsnoop file")
    offset = _FILE_HEADER
    rows: list[dict] = []
    while offset + _REC_HEADER.size <= len(data):
        orig, incl, flags, _drops, ts = _REC_HEADER.unpack_from(data, offset)
        offset += _REC_HEADER.size
        payload = data[offset:offset + incl]
        offset += incl
        rows.append({
            "ts": ts,
            "direction": "recv" if flags & 0x01 else "send",
            "hex": payload.hex(),
            "ascii": payload.decode("ascii", errors="replace"),
        })
    return rows


if __name__ == "__main__":
    for row in parse(Path(sys.argv[1])):
        print(f"{row['ts']:>16} {row['direction']:>4}  {row['ascii']!r}")
