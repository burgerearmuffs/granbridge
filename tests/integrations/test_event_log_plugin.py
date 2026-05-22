"""Tests for EventLogPlugin (decoded-event file sink)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from granbridge.events.models import ConnectionState, DartHit, Ring
from granbridge.integrations.plugins.event_log_plugin import EventLogPlugin


def _hit() -> DartHit:
    return DartHit(raw="T20@", ring=Ring.TRIPLE, segment=20, multiplier=3, bed="T20", score=60)


def _conn() -> ConnectionState:
    return ConnectionState(state="connected")


async def test_event_log_creates_jsonl_with_correct_line_count(tmp_path: Path) -> None:
    plugin = EventLogPlugin({"dir": tmp_path})
    await plugin.start()

    await plugin.handle(_hit())
    await plugin.handle(_conn())
    await plugin.handle(_hit())

    log_file = tmp_path / "events.jsonl"
    assert log_file.exists(), "events.jsonl was not created"
    lines = log_file.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 3, f"Expected 3 lines, got {len(lines)}"


async def test_event_log_lines_are_valid_json_with_correct_types(tmp_path: Path) -> None:
    plugin = EventLogPlugin({"dir": tmp_path})
    await plugin.start()

    await plugin.handle(_hit())
    await plugin.handle(_conn())

    lines = (tmp_path / "events.jsonl").read_text(encoding="utf-8").splitlines()
    parsed = [json.loads(line) for line in lines]
    assert parsed[0]["type"] == "dart_hit"
    assert parsed[1]["type"] == "connection_state"


async def test_event_log_start_creates_directory(tmp_path: Path) -> None:
    target = tmp_path / "nested" / "decoded_packets"
    plugin = EventLogPlugin({"dir": target})
    await plugin.start()
    assert target.is_dir()


async def test_event_log_default_dir_used_when_no_config() -> None:
    """Plugin must not raise when config is empty (uses default dir path)."""
    plugin = EventLogPlugin({})
    assert plugin._dir == Path("logs/decoded_packets")


async def test_event_log_handle_is_defensive(tmp_path: Path, monkeypatch) -> None:
    """handle() must not propagate exceptions (e.g. on IO error)."""
    plugin = EventLogPlugin({"dir": tmp_path})
    await plugin.start()

    # Make write fail by replacing the dir with a file so open() will fail
    log_file = tmp_path / "events.jsonl"
    log_file.write_text("seed")
    # Monkeypatch open to raise
    import builtins
    original_open = builtins.open

    def _bad_open(*args, **kwargs):
        if "events.jsonl" in str(args[0]):
            raise OSError("simulated disk error")
        return original_open(*args, **kwargs)

    monkeypatch.setattr(builtins, "open", _bad_open)
    # Must not raise
    await plugin.handle(_hit())
