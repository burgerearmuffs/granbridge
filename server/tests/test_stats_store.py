# server/tests/test_stats_store.py
import pytest
from granbridge_broker.stats import StatsStore, ValidationError


def _match(match_id="m1", winner="P1", opponent="P2", mode="x01",
           darts=9, total=180, is_remote=True, throws=None):
    return {
        "match_id": match_id, "mode": mode, "opponent_id": opponent,
        "winner_id": winner, "is_remote": is_remote, "darts": darts,
        "total_scored": total, "started_at": "2026-05-24T10:00:00.000Z",
        "ended_at": "2026-05-24T10:05:00.000Z", "throws": throws,
    }


def test_first_submit_registers_token_and_records_match(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    out = s.submit_match("P1", "tok-1", _match(), display_name="Ann", avatar_color="#f00")
    assert out == {"match_id": "m1", "verified": False}
    summary = s.player_summary("P1")
    assert summary["games_played"] == 1
    assert summary["wins"] == 1
    assert summary["display_name"] == "Ann"


def test_second_submit_with_wrong_token_is_rejected(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    s.submit_match("P1", "tok-1", _match())
    with pytest.raises(PermissionError):
        s.submit_match("P1", "WRONG", _match(match_id="m2"))


def test_resubmit_same_match_is_idempotent(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    s.submit_match("P1", "tok-1", _match(darts=9, total=180))
    s.submit_match("P1", "tok-1", _match(darts=9, total=180))  # same match_id
    assert s.player_summary("P1")["games_played"] == 1


def test_implausible_match_rejected(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    with pytest.raises(ValidationError):
        s.submit_match("P1", "tok-1", _match(darts=3, total=181))  # > darts*60
