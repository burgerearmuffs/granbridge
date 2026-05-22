from __future__ import annotations

import pytest
from pathlib import Path

from granbridge.history.store import HistoryStore


def test_start_game_returns_id(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "history.db")
    gid = store.start_game("x01", ["Alice", "Bob"], {"legs": 3})
    assert isinstance(gid, int)
    assert gid > 0


def test_recent_games_returns_game_with_winner(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "history.db")
    gid = store.start_game("x01", ["Alice", "Bob"], {"legs": 3})
    store.record_throw(gid, "Alice", "T20", 60)
    store.record_throw(gid, "Alice", "T19", 57)
    store.record_throw(gid, "Bob", "S1", 1)
    store.end_game(gid, "Alice")

    games = store.recent_games()
    assert len(games) == 1
    g = games[0]
    assert g["id"] == gid
    assert g["mode"] == "x01"
    assert g["winner"] == "Alice"
    assert g["ended_at"] is not None


def test_player_stats_three_dart_avg(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "history.db")
    gid = store.start_game("x01", ["Alice"], {})
    # 3 darts totalling 120 -> three_dart_avg = 120 / 3 * 3 = 120.0
    store.record_throw(gid, "Alice", "T20", 60)
    store.record_throw(gid, "Alice", "T20", 60)
    store.record_throw(gid, "Alice", "D0", 0)  # miss, 0 pts
    # Actually: total=120, darts=3, avg = 120/3*3 = 120.0
    # Let's use a simple case: 3 darts of 20 each = 60, avg = 60/3*3 = 60.0
    store.end_game(gid, "Alice")

    stats = store.player_stats()
    assert len(stats) == 1
    s = stats[0]
    assert s["player"] == "Alice"
    assert s["games_played"] == 1
    assert s["wins"] == 1
    assert s["darts"] == 3
    assert s["total_scored"] == 120
    # three_dart_avg = round(120 / 3 * 3, 2) = 120.0
    assert s["three_dart_avg"] == 120.0


def test_player_stats_three_dart_avg_fractional(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "history.db")
    gid = store.start_game("x01", ["Bob"], {})
    # 4 darts of 20 each = 80 total
    # three_dart_avg = round(80 / 4 * 3, 2) = round(60.0, 2) = 60.0
    for _ in range(4):
        store.record_throw(gid, "Bob", "S20", 20)
    store.end_game(gid, "Bob")

    stats = store.player_stats()
    s = next(x for x in stats if x["player"] == "Bob")
    assert s["darts"] == 4
    assert s["total_scored"] == 80
    assert s["three_dart_avg"] == 60.0


def test_hit_counts_all_games(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "history.db")
    gid = store.start_game("x01", ["Alice"], {})
    store.record_throw(gid, "Alice", "T20", 60)
    store.record_throw(gid, "Alice", "T20", 60)
    store.record_throw(gid, "Alice", "S5", 5)
    store.end_game(gid, "Alice")

    counts = store.hit_counts()
    assert counts["T20"] == 2
    assert counts["S5"] == 1


def test_hit_counts_scoped_to_game(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "history.db")
    gid1 = store.start_game("x01", ["Alice"], {})
    store.record_throw(gid1, "Alice", "T20", 60)
    store.end_game(gid1, "Alice")

    gid2 = store.start_game("x01", ["Bob"], {})
    store.record_throw(gid2, "Bob", "S5", 5)
    store.end_game(gid2, "Bob")

    counts1 = store.hit_counts(game_id=gid1)
    counts2 = store.hit_counts(game_id=gid2)

    assert counts1 == {"T20": 1}
    assert counts2 == {"S5": 1}


def test_recent_games_limit(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "history.db")
    for i in range(5):
        gid = store.start_game("x01", [f"p{i}"], {})
        store.end_game(gid, f"p{i}")

    games = store.recent_games(limit=3)
    assert len(games) == 3


def test_player_stats_no_throws(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "history.db")
    # No games recorded; should return empty list
    stats = store.player_stats()
    assert stats == []
