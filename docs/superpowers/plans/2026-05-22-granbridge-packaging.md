# GRANBRIDGE Packaging (PyInstaller self-serving exe) — Design + Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Subagent does NOT commit (controller squash-commits). PyInstaller bundling of Bleak/WinRT is iterative — rebuild and add hidden imports until the exe runs.

**Goal:** A double-clickable `granbridge.exe` that runs the bridge AND serves the built UI + overlays over HTTP on localhost, so the user can test the whole stack with one artifact (no venv, no `npm run dev`). This exe is also the sidecar the later Tauri app will bundle.

**Design:**
- Add an HTTP **static server** (stdlib `http.server` in a daemon thread) on `http_port` (default 8080) serving the UI at `/` and overlays at `/overlays/`. The WS stays on 8787; the UI already points at `ws://127.0.0.1:8787`.
- A **resource resolver** returns the correct asset dirs whether running from source or frozen (`sys._MEIPASS`).
- `serve` starts the static server alongside the connection manager + engine + plugins; a `--open/--no-open` flag opens the browser. The frozen entry: no CLI args → `serve --open`; otherwise dispatch the Typer CLI.
- A PyInstaller **spec** bundles the package + Bleak/WinRT (+ optional integration libs) + the UI/overlay assets, **onedir** (reliable for WinRT), producing `dist/granbridge/granbridge.exe`.

**Stack:** Python stdlib http.server, PyInstaller 6.20, existing deps.

---

## Task 1: Static server + resource resolver

**Files:** `src/granbridge/resources.py`, `src/granbridge/api/static_server.py`; tests `tests/api/test_static_server.py`.

- [ ] **resources.py**
```python
from __future__ import annotations
import sys
from pathlib import Path

def is_frozen() -> bool:
    return getattr(sys, "frozen", False)

def static_dirs() -> tuple[Path, Path]:
    """Return (ui_dir, overlay_dir) for both source and PyInstaller-frozen runs."""
    if is_frozen():
        base = Path(getattr(sys, "_MEIPASS"))
        return base / "ui_dist", base / "overlay"
    repo = Path(__file__).resolve().parents[2]   # src/granbridge/resources.py -> repo root
    return repo / "ui" / "dist", repo / "src" / "granbridge" / "overlay"
```

- [ ] **static_server.py**
```python
from __future__ import annotations
import functools
import http.server
import threading
from pathlib import Path
from typing import Optional

import structlog

log = structlog.get_logger(__name__)


class _Handler(http.server.SimpleHTTPRequestHandler):
    ui_dir: Path
    overlay_dir: Path

    def translate_path(self, path: str) -> str:
        # /overlays/foo.html -> overlay_dir/foo.html ; everything else -> ui_dir
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith("/overlays/"):
            rel = clean[len("/overlays/"):] or "launcher.html"
            return str(self.overlay_dir / rel)
        rel = clean.lstrip("/") or "index.html"
        return str(self.ui_dir / rel)

    def log_message(self, *args) -> None:  # quiet
        return


class StaticServer:
    """Serves the built UI at / and overlays at /overlays/ on a daemon thread."""

    def __init__(self, ui_dir: Path, overlay_dir: Path, host: str = "127.0.0.1", port: int = 8080) -> None:
        handler = type("Bound_Handler", (_Handler,), {"ui_dir": ui_dir, "overlay_dir": overlay_dir})
        self._httpd = http.server.ThreadingHTTPServer((host, port), handler)
        self._thread: Optional[threading.Thread] = None
        self.host, self.port = host, port

    def start(self) -> None:
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        log.info("static.started", host=self.host, port=self.port)

    def stop(self) -> None:
        self._httpd.shutdown()
```

- [ ] **test** `tests/api/test_static_server.py`
```python
import urllib.request
from pathlib import Path
from granbridge.api.static_server import StaticServer

def test_serves_ui_and_overlays(tmp_path):
    ui = tmp_path / "ui"; ui.mkdir(); (ui / "index.html").write_text("<h1>UI</h1>")
    ov = tmp_path / "ov"; ov.mkdir(); (ov / "launcher.html").write_text("<h1>OVL</h1>")
    s = StaticServer(ui, ov, "127.0.0.1", 8765); s.start()
    try:
        assert "UI" in urllib.request.urlopen("http://127.0.0.1:8765/").read().decode()
        assert "OVL" in urllib.request.urlopen("http://127.0.0.1:8765/overlays/launcher.html").read().decode()
    finally:
        s.stop()
```
- [ ] Run `.venv\Scripts\python -m pytest tests/api/test_static_server.py -v` → pass.

---

## Task 2: Wire into CLI + browser open

**Files:** modify `src/granbridge/config.py` (add `http_port: int = 8080`), `src/granbridge/cli.py`.

- [ ] In `config.py` add `http_port: int = 8080`.
- [ ] In `cli.py`: import `StaticServer` + `static_dirs`. Add `serve(open_browser: bool = typer.Option(False, "--open/--no-open"))`. In `serve._run()`, before the gather:
```python
        ui_dir, overlay_dir = static_dirs()
        static = StaticServer(ui_dir, overlay_dir, settings.ws_host, settings.http_port)
        static.start()
        typer.echo(f"UI at http://{settings.ws_host}:{settings.http_port}  |  WS ws://{settings.ws_host}:{settings.ws_port}")
        if open_browser:
            import webbrowser
            webbrowser.open(f"http://{settings.ws_host}:{settings.http_port}")
```
  Keep the existing `asyncio.gather(mgr.run(), engine.attach(), plugin_mgr.run())`. (Static server is threaded, not in the gather.)
- [ ] Light test: extend `tests/test_cli.py` to assert `serve --help` shows `--open`. Run `pytest -q` → all pass; `python -c "import granbridge.cli"` clean.

---

## Task 3: PyInstaller entry + spec

**Files:** `packaging/granbridge_entry.py`, `packaging/granbridge.spec`.

- [ ] **`packaging/granbridge_entry.py`**
```python
"""Frozen entrypoint: no args -> serve+open browser; else the CLI."""
import sys

def main() -> None:
    from granbridge.cli import app
    if len(sys.argv) == 1:
        sys.argv += ["serve", "--open"]
    app()

if __name__ == "__main__":
    main()
```

- [ ] **`packaging/granbridge.spec`**
```python
# PyInstaller spec — onedir build of granbridge.exe (self-serving bridge + UI)
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas = [("../ui/dist", "ui_dist"), ("../src/granbridge/overlay", "overlay")]
binaries = []
hiddenimports = []
for pkg in ("bleak", "winrt", "winrt_runtime", "websockets", "pydantic", "pydantic_settings",
            "structlog", "typer", "click", "aiomqtt", "httpx"):
    try:
        d, b, h = collect_all(pkg)
        datas += d; binaries += b; hiddenimports += h
    except Exception:
        pass
hiddenimports += collect_submodules("winrt")

a = Analysis(["granbridge_entry.py"], pathex=["../src"], binaries=binaries, datas=datas,
             hiddenimports=hiddenimports, noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="granbridge", console=True)
coll = COLLECT(exe, a.binaries, a.datas, name="granbridge")
```

---

## Task 4: Build + smoke test

- [ ] Build (from repo root):
`.venv\Scripts\python -m PyInstaller packaging/granbridge.spec --noconfirm --distpath dist --workpath build/pyi`
- [ ] Smoke: `dist\granbridge\granbridge.exe --help` → shows commands (proves clean import incl. typer/click).
- [ ] Smoke: `dist\granbridge\granbridge.exe scan` → runs (may find no board) WITHOUT ImportError (proves bleak/winrt bundled). If it errors on a missing winrt submodule, add that submodule to `hiddenimports` in the spec and rebuild. Iterate until both smokes pass.
- [ ] (Do NOT run `serve` headless in CI — it blocks. The user will double-click to test.)
- [ ] Add `dist/`, `build/` to `.gitignore` (the exe artifacts are not committed).

---

## Task 5: Docs

- [ ] README "Packaged app (Windows)" section: build with the PyInstaller command above; run `dist\granbridge\granbridge.exe` (double-click) → it serves the UI at http://127.0.0.1:8080 and opens the browser, with the bridge on ws://127.0.0.1:8787. CLI subcommands still work (`granbridge.exe scan`, `... calibrate`). Note the native Tauri app (Step 2b) bundles this exe as a sidecar.

---

## Self-Review
- **Coverage:** self-serving HTTP (T1/T2), one-click frozen entry (T3), exe build + smoke (T4), docs (T5).
- **Placeholders:** full code for static server/resolver/entry/spec; PyInstaller hidden-imports may need iteration (documented in T4).
- **Safety:** static server binds localhost; serves only the UI + overlay dirs (translate_path maps into those roots); no arbitrary FS exposure beyond them.
- **Reuse:** the produced exe is the Tauri sidecar for Step 2b — not throwaway.
