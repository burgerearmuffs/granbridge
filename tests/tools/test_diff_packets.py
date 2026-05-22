import sys
from pathlib import Path
sys.path.insert(0, str(Path("tools").resolve()))
from diff_packets import diff_frames

def test_diff_reports_unique_and_shared():
    a = ["2.5", "8.0", "2.5"]
    b = ["8.0", "OUT"]
    result = diff_frames(a, b)
    assert result["only_a"] == {"2.5"}
    assert result["only_b"] == {"OUT"}
    assert result["shared"] == {"8.0"}
