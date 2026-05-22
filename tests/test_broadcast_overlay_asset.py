from pathlib import Path

def test_broadcast_overlay_supports_two_cameras_and_score():
    html = Path("src/granbridge/overlay/broadcast.html").read_text()
    assert html.count("<video") >= 2
    assert "getUserMedia" in html and "enumerateDevices" in html
    assert "8787" in html and "dart_hit" in html
    assert "cam1" in html and "cam2" in html
