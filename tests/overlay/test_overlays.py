from pathlib import Path
import pytest

OVERLAY = Path("src/granbridge/overlay")

CASES = {
    "scoreboard.html": ["game_state"],
    "checkout.html": ["game_state", "checkout"],
    "throw.html": ["dart_hit"],
    "stats.html": ["game_state", "three_dart_avg"],
    "lower-third.html": ["game"],  # game_started or game_state
}

@pytest.mark.parametrize("fname,needles", CASES.items())
def test_overlay_contract(fname, needles):
    html = (OVERLAY / fname).read_text(encoding="utf-8")
    assert "common.js" in html, f"{fname} must load common.js"
    assert "innerHTML" not in html, f"{fname} must use safe DOM"
    for n in needles:
        assert n in html, f"{fname} must reference {n}"

def test_common_js_exports_helper():
    assert "connectGranbridge" in (OVERLAY / "common.js").read_text(encoding="utf-8")

def test_launcher_lists_overlays():
    html = (OVERLAY / "launcher.html").read_text(encoding="utf-8")
    for f in ["scoreboard.html", "checkout.html", "throw.html", "stats.html", "lower-third.html",
              "game.html", "broadcast.html"]:
        assert f in html
