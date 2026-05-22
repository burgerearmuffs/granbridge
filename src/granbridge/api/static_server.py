from __future__ import annotations
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
        # Strip query string and fragment
        clean = path.split("?", 1)[0].split("#", 1)[0]

        if clean.startswith("/overlays/"):
            rel = clean[len("/overlays/"):] or "launcher.html"
            candidate = (self.overlay_dir / rel).resolve()
            # Security: prevent path traversal outside overlay_dir
            try:
                candidate.relative_to(self.overlay_dir.resolve())
            except ValueError:
                # Attempted traversal — return the root dir itself (yields 404 for directory)
                return str(self.overlay_dir.resolve())
            return str(candidate)

        rel = clean.lstrip("/") or "index.html"
        candidate = (self.ui_dir / rel).resolve()
        # Security: prevent path traversal outside ui_dir
        try:
            candidate.relative_to(self.ui_dir.resolve())
        except ValueError:
            return str(self.ui_dir.resolve())
        return str(candidate)

    def log_message(self, *args) -> None:  # quiet
        return


class StaticServer:
    """Serves the built UI at / and overlays at /overlays/ on a daemon thread."""

    def __init__(
        self,
        ui_dir: Path,
        overlay_dir: Path,
        host: str = "127.0.0.1",
        port: int = 8080,
    ) -> None:
        handler = type(
            "Bound_Handler",
            (_Handler,),
            {"ui_dir": ui_dir, "overlay_dir": overlay_dir},
        )
        self._httpd = http.server.ThreadingHTTPServer((host, port), handler)
        self._thread: Optional[threading.Thread] = None
        self.host, self.port = host, port

    def start(self) -> None:
        self._thread = threading.Thread(
            target=self._httpd.serve_forever, daemon=True
        )
        self._thread.start()
        log.info("static.started", host=self.host, port=self.port)

    def stop(self) -> None:
        self._httpd.shutdown()
