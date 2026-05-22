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
