from granbridge.protocol.frames import FrameAssembler

def test_single_complete_frame():
    assert FrameAssembler().feed(b"2.5@") == ["2.5"]

def test_partial_then_completed():
    fa = FrameAssembler()
    assert fa.feed(b"2.") == []
    assert fa.feed(b"5@") == ["2.5"]

def test_multiple_frames_in_one_chunk():
    assert FrameAssembler().feed(b"2.5@8.0@OUT@") == ["2.5", "8.0", "OUT"]

def test_strips_known_prefix():
    assert FrameAssembler(prefixes=("GB8;102",)).feed(b"GB8;1022.5@") == ["2.5"]

def test_dedup_identical_within_window():
    clock = [0.0]
    fa = FrameAssembler(dedup_window_s=0.05, clock=lambda: clock[0])
    assert fa.feed(b"2.5@") == ["2.5"]
    clock[0] = 0.01
    assert fa.feed(b"2.5@") == []
    clock[0] = 0.20
    assert fa.feed(b"2.5@") == ["2.5"]

def test_empty_frames_ignored():
    assert FrameAssembler().feed(b"@@2.5@@") == ["2.5"]

def test_reset_drops_stale_partial():
    fa = FrameAssembler()
    assert fa.feed(b"99.") == []          # partial fragment buffered (no terminator yet)
    fa.reset()                            # simulate a reconnect
    assert fa.feed(b"1.1@") == ["1.1"]    # buffer cleared -> not "99.1.1"

def test_reset_clears_dedup_state():
    fa = FrameAssembler(dedup_window_s=10.0)
    assert fa.feed(b"2.5@") == ["2.5"]
    assert fa.feed(b"2.5@") == []         # deduped within the 10s window
    fa.reset()                            # simulate a reconnect
    assert fa.feed(b"2.5@") == ["2.5"]    # dedup state cleared -> first throw emitted

def test_strips_connect_handshake_glued_to_first_frame():
    # Real GRANBOARD 3s behaviour (captured 2026-05-22): a "GB7;101" handshake notification with
    # no terminator buffers and glues onto the first real frame; it must be stripped.
    fa = FrameAssembler()
    assert fa.feed(b"GB7;101") == []        # handshake, no '@' -> buffered
    assert fa.feed(b"3.5@") == ["3.5"]      # handshake stripped -> clean S20 frame
    # also the GB8;102 variant, in one chunk
    fa2 = FrameAssembler()
    assert fa2.feed(b"GB8;1027.0@") == ["7.0"]
