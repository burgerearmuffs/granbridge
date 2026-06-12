from __future__ import annotations

import json
import urllib.request
import urllib.error
from pathlib import Path

from granbridge.api.static_server import StaticServer


def test_api_route_returns_json(tmp_path: Path) -> None:
    """A registered route should return JSON with 200."""
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<h1>UI</h1>")
    ov = tmp_path / "ov"
    ov.mkdir()

    s = StaticServer(
        ui,
        ov,
        "127.0.0.1",
        8770,
        routes={"/api/test": lambda: {"ok": True}},
    )
    s.start()
    try:
        resp = urllib.request.urlopen("http://127.0.0.1:8770/api/test")
        assert resp.status == 200
        assert resp.headers.get("Content-Type") == "application/json"
        body = json.loads(resp.read().decode())
        assert body == {"ok": True}
    finally:
        s.stop()


def test_non_route_falls_through_to_static(tmp_path: Path) -> None:
    """Paths not in routes fall through to the normal static file handler."""
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<h1>STATIC</h1>")
    ov = tmp_path / "ov"
    ov.mkdir()

    s = StaticServer(
        ui,
        ov,
        "127.0.0.1",
        8771,
        routes={"/api/test": lambda: {"ok": True}},
    )
    s.start()
    try:
        resp = urllib.request.urlopen("http://127.0.0.1:8771/")
        assert "STATIC" in resp.read().decode()
    finally:
        s.stop()


def test_no_routes_still_serves_static(tmp_path: Path) -> None:
    """StaticServer with routes=None behaves exactly as before."""
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<h1>ORIGINAL</h1>")
    ov = tmp_path / "ov"
    ov.mkdir()

    s = StaticServer(ui, ov, "127.0.0.1", 8772)
    s.start()
    try:
        resp = urllib.request.urlopen("http://127.0.0.1:8772/")
        assert "ORIGINAL" in resp.read().decode()
    finally:
        s.stop()


def test_api_route_with_query_string(tmp_path: Path) -> None:
    """Routes should match even when the URL contains a query string."""
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<h1>UI</h1>")
    ov = tmp_path / "ov"
    ov.mkdir()

    s = StaticServer(
        ui,
        ov,
        "127.0.0.1",
        8773,
        routes={"/api/data": lambda: [1, 2, 3]},
    )
    s.start()
    try:
        resp = urllib.request.urlopen("http://127.0.0.1:8773/api/data?limit=5")
        body = json.loads(resp.read().decode())
        assert body == [1, 2, 3]
    finally:
        s.stop()


def test_api_route_sends_cors_header(tmp_path: Path) -> None:
    """API routes must allow cross-origin reads: the packaged Tauri webview
    (origin tauri://localhost) fetches them from a different origin than the bridge,
    so without Access-Control-Allow-Origin the browser blocks reading the response."""
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<h1>UI</h1>")
    ov = tmp_path / "ov"
    ov.mkdir()

    s = StaticServer(
        ui,
        ov,
        "127.0.0.1",
        8774,
        routes={"/api/test": lambda: {"ok": True}},
    )
    s.start()
    try:
        resp = urllib.request.urlopen("http://127.0.0.1:8774/api/test")
        assert resp.headers.get("Access-Control-Allow-Origin") == "*"
    finally:
        s.stop()


def test_post_route_invokes_handler(tmp_path: Path) -> None:
    """POST routes run their handler and return JSON; GET on the same path 404s."""
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<h1>UI</h1>")
    ov = tmp_path / "ov"
    ov.mkdir()

    calls: list[int] = []

    def clear() -> dict:
        calls.append(1)
        return {"cleared_games": 2}

    s = StaticServer(
        ui,
        ov,
        "127.0.0.1",
        8775,
        post_routes={"/api/history/clear": clear},
    )
    s.start()
    try:
        req = urllib.request.Request("http://127.0.0.1:8775/api/history/clear", method="POST")
        resp = urllib.request.urlopen(req)
        assert resp.status == 200
        assert json.loads(resp.read().decode()) == {"cleared_games": 2}
        assert resp.headers.get("Access-Control-Allow-Origin") == "*"
        assert calls == [1]
    finally:
        s.stop()


def test_post_to_unknown_path_returns_404(tmp_path: Path) -> None:
    ui = tmp_path / "ui"
    ui.mkdir()
    ov = tmp_path / "ov"
    ov.mkdir()

    s = StaticServer(ui, ov, "127.0.0.1", 8776, post_routes={"/api/x": lambda: {}})
    s.start()
    try:
        req = urllib.request.Request("http://127.0.0.1:8776/api/other", method="POST")
        try:
            urllib.request.urlopen(req)
            raise AssertionError("expected 404")
        except urllib.error.HTTPError as e:
            assert e.code == 404
    finally:
        s.stop()
