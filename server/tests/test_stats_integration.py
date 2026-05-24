"""Stats persistence across a fresh StatsStore reopen (simulates a container restart
on a mounted volume). Always runs (no docker needed); proves the on-disk DB survives.
"""
from granbridge_broker.stats import StatsStore


def _m(match_id, winner="P1"):
    return {"match_id": match_id, "mode": "x01", "opponent_id": None, "winner_id": winner,
            "is_remote": False, "darts": 9, "total_scored": 180,
            "started_at": "2026-05-24T10:00:00.000Z", "ended_at": "2026-05-24T10:05:00.000Z",
            "throws": [{"bed": "T20", "score": 60, "ts": "2026-05-24T10:00:01.000Z"}]}


def test_stats_persist_across_reopen(tmp_path):
    db = tmp_path / "stats.db"
    s1 = StatsStore(db)
    s1.submit_match("P1", "t1", _m("m1"))
    del s1
    s2 = StatsStore(db)  # reopen same file (like a container restart on the volume)
    summary = s2.player_summary("P1")
    assert summary["games_played"] == 1
    assert summary["heatmap"]["T20"] == 1
    # token still enforced after reopen
    import pytest
    with pytest.raises(PermissionError):
        s2.submit_match("P1", "WRONG", _m("m2"))
