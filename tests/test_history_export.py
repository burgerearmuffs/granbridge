import shutil
import tempfile
from pathlib import Path

from granbridge.history.store import HistoryStore


def _store():
    # NOTE: this environment's pytest tmp_path fixture hits a PermissionError on
    # Temp\pytest-of-<user>; mkdtemp to the temp ROOT works, so use it directly.
    d = Path(tempfile.mkdtemp())
    return HistoryStore(d / "hist.db"), d


def test_export_latest_returns_finished_game_with_throws():
    store, d = _store()
    try:
        gid = store.start_game("x01", ["Ann", "Bob"], {"start_score": 501})
        store.record_throw(gid, "Ann", "T20", 60)
        store.record_throw(gid, "Bob", "S5", 5)
        store.end_game(gid, "Ann")
        rec = store.export_latest_match()
        assert rec["mode"] == "x01"
        assert rec["players"] == ["Ann", "Bob"]
        assert rec["winner"] == "Ann"
        assert rec["started_at"] and rec["ended_at"]
        beds = {(t["player"], t["bed"], t["score"]) for t in rec["throws"]}
        assert ("Ann", "T20", 60) in beds and ("Bob", "S5", 5) in beds
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_export_latest_empty_when_no_finished_game():
    store, d = _store()
    try:
        store.start_game("x01", ["Ann"], {})  # not ended
        assert store.export_latest_match() == {}
    finally:
        shutil.rmtree(d, ignore_errors=True)
