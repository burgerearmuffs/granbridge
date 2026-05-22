import sys
from pathlib import Path
sys.path.insert(0, str(Path("tools").resolve()))
from identify_hits import classify_frame

def test_hit_frame_classified():
    assert classify_frame("12.3") == "hit"
    assert classify_frame("8.0") == "hit"
    assert classify_frame("OUT") == "button"

def test_non_coordinate_classified_other():
    assert classify_frame("HELLO") == "other"
