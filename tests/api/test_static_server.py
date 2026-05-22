import urllib.request
import urllib.error
from pathlib import Path

from granbridge.api.static_server import StaticServer


def test_serves_ui_and_overlays(tmp_path):
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<h1>UI</h1>")

    ov = tmp_path / "ov"
    ov.mkdir()
    (ov / "launcher.html").write_text("<h1>OVL</h1>")

    s = StaticServer(ui, ov, "127.0.0.1", 8765)
    s.start()
    try:
        assert "UI" in urllib.request.urlopen("http://127.0.0.1:8765/").read().decode()
        assert "OVL" in urllib.request.urlopen(
            "http://127.0.0.1:8765/overlays/launcher.html"
        ).read().decode()
    finally:
        s.stop()


def test_traversal_does_not_escape_overlay_root(tmp_path):
    """A path-traversal request must NOT return content from outside the roots."""
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<h1>UI</h1>")

    ov = tmp_path / "ov"
    ov.mkdir()
    (ov / "launcher.html").write_text("<h1>OVL</h1>")

    # Create a "secret" file one level above the roots (at tmp_path)
    secret = tmp_path / "secret.txt"
    secret.write_text("SECRET CONTENT")

    s = StaticServer(ui, ov, "127.0.0.1", 8766)
    s.start()
    try:
        # Attempt traversal: /overlays/../../secret.txt  -> should NOT return secret
        try:
            resp = urllib.request.urlopen(
                "http://127.0.0.1:8766/overlays/../../secret.txt"
            ).read().decode()
            assert "SECRET" not in resp, "Path traversal escaped overlay root!"
        except urllib.error.HTTPError:
            pass  # 404 / 403 is the expected safe outcome

        # Attempt traversal via ui root: /../../secret.txt -> should NOT return secret
        try:
            resp2 = urllib.request.urlopen(
                "http://127.0.0.1:8766/../../secret.txt"
            ).read().decode()
            assert "SECRET" not in resp2, "Path traversal escaped ui root!"
        except urllib.error.HTTPError:
            pass  # 404 / 403 is the expected safe outcome
    finally:
        s.stop()
