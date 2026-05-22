from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

import structlog


def configure_logging(log_dir: Path) -> None:
    """Configure structlog to render JSON and route to rotating files per category."""
    for sub in ("raw_packets", "decoded_packets", "sessions", "crashes"):
        (log_dir / sub).mkdir(parents=True, exist_ok=True)

    handler = RotatingFileHandler(
        log_dir / "sessions" / "granbridge.log.jsonl",
        maxBytes=5_000_000,
        backupCount=5,
        encoding="utf-8",
    )
    logging.basicConfig(handlers=[handler, logging.StreamHandler()], level=logging.INFO)
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
    )
