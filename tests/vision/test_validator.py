from granbridge.vision.validator import NoOpValidator, ValidationResult
from granbridge.events.models import DartHit, Ring

def test_noop_agrees():
    r = NoOpValidator().validate(DartHit(raw="T20@", ring=Ring.TRIPLE, segment=20, multiplier=3, bed="T20", score=60))
    assert isinstance(r, ValidationResult) and r.agreed is True and r.detected_bed == "T20"
