from pathlib import Path
def test_game_overlay_consumes_game_state():
    html = Path("src/granbridge/overlay/game.html").read_text()
    assert "game_state" in html and "8787" in html and "checkout" in html and "WebSocket" in html
    assert "innerHTML" not in html  # safe DOM construction only
