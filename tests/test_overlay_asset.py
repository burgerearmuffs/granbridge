from pathlib import Path

def test_overlay_connects_to_default_ws_port():
    html = Path("src/granbridge/overlay/index.html").read_text()
    assert "8787" in html
    assert "dart_hit" in html
    assert "WebSocket" in html
