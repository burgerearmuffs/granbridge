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
