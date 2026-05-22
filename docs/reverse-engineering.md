# Reverse-Engineering Workflow

GRANBOARD sends ASCII frames terminated by `@`, e.g. `2.5@`, where the two numbers
are a physical-segment matrix coordinate (NOT a score). The seed map only knows the
bulls and OUT; the rest is filled by calibration or by analyzing captures.

## Live calibration (easiest)
`granbridge calibrate` connects to the board and walks you through throwing at known
beds, recording each raw frame into `segment_map.overrides.json`. Ctrl-C saves a
partial map. This is the fastest path to a correct board map.

## Capture analysis (Android HCI snoop)
1. On an Android phone with the official app: enable Developer Options → "Enable
   Bluetooth HCI snoop log". Reproduce throws, then pull `btsnoop_hci.log`.
2. `python tools/parse_hci.py btsnoop_hci.log` — prints each ATT payload as
   direction + ASCII so you can see the raw frames.
3. Collect the frame bodies (strip the trailing `@`). Use:
   - `tools/identify_hits.py:classify_frame(body)` to label hit/button/other.
   - `tools/diff_packets.py:diff_frames(a, b)` to compare two capture sets (e.g. T20
     vs D20) and isolate which coordinate changed.
4. Feed confirmed mappings into the segment map (via `calibrate` or by editing the
   overrides JSON).
