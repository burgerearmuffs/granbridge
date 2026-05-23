from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GRANBRIDGE_")

    ws_host: str = "127.0.0.1"
    ws_port: int = 8787
    allowed_origins: list[str] = []
    board_name_prefix: str = "GRAN"
    vendor_service_uuid: str = "442f1570-8a00-9a28-cbe1-e1d4212d53eb"
    backoff_base: float = 0.5
    backoff_cap: float = 30.0
    heartbeat_timeout: float = 0.0  # 0 = disabled; GRANBOARD is silent between throws, so a
    #                                 silence-watchdog falsely fires. Drops are caught by the BLE
    #                                 disconnect callback. Set >0 only as a stale-connection backstop.
    dedup_window_s: float = 0.05
    log_dir: Path = Path(os.environ.get("LOCALAPPDATA", ".")) / "granbridge" / "logs"
    overrides_path: Path = Path(os.environ.get("LOCALAPPDATA", ".")) / "granbridge" / "segment_map.overrides.json"
    http_port: int = 8080
    plugins_enabled: list[str] = []
    plugins: dict[str, dict] = {}
    history_db: Path = Path(os.environ.get("LOCALAPPDATA", ".")) / "granbridge" / "history.db"
