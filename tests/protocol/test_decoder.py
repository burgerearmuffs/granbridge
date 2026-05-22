from granbridge.protocol.segment_map import SegmentMap
from granbridge.protocol.decoder import Decoder
from granbridge.events.models import DartHit, ErrorEvent, Ring

def _decoder_with(body, ring, number):
    sm = SegmentMap()
    sm.set_override(body, ring, number)
    return Decoder(sm)

def test_triple_twenty_scores_sixty():
    hit = _decoder_with("12.3", Ring.TRIPLE, 20).decode("12.3")
    assert isinstance(hit, DartHit)
    assert hit.bed == "T20" and hit.score == 60 and hit.multiplier == 3
    assert hit.raw == "12.3@"

def test_single_outer_scores_face_value():
    hit = _decoder_with("1.1", Ring.SINGLE_OUTER, 5).decode("1.1")
    assert hit.bed == "S5" and hit.score == 5 and hit.multiplier == 1

def test_double_scores_double():
    hit = _decoder_with("9.2", Ring.DOUBLE, 16).decode("9.2")
    assert hit.bed == "D16" and hit.score == 32 and hit.multiplier == 2

def test_single_bull_from_seed():
    hit = Decoder(SegmentMap()).decode("8.0")
    assert hit.bed == "BULL" and hit.score == 25 and hit.segment == 25

def test_double_bull_from_seed():
    hit = Decoder(SegmentMap()).decode("4.0")
    assert hit.bed == "DBULL" and hit.score == 50 and hit.multiplier == 2

def test_out_is_a_miss():
    hit = Decoder(SegmentMap()).decode("OUT")
    assert hit.bed == "MISS" and hit.score == 0 and hit.segment is None

def test_unknown_frame_becomes_error_event():
    err = Decoder(SegmentMap()).decode("99.99")
    assert isinstance(err, ErrorEvent)
    assert err.category == "decode" and err.recoverable is True
    assert "99.99" in err.message
