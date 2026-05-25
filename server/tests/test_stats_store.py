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


def test_match_verifies_when_both_report_same_winner(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    # P1 reports the match (winner P1); not yet verified (only one reporter)
    out1 = s.submit_match("P1", "t1", _match(match_id="shared", winner="P1", opponent="P2"))
    assert out1["verified"] is False
    # P2 reports the SAME match_id, same winner -> verifies both rows
    out2 = s.submit_match("P2", "t2", _match(match_id="shared", winner="P1", opponent="P1"))
    assert out2["verified"] is True
    assert s.player_summary("P1")["verified_games"] == 1
    assert s.player_summary("P2")["verified_games"] == 1


def test_disagreeing_winners_stay_unverified(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    s.submit_match("P1", "t1", _match(match_id="dispute", winner="P1", opponent="P2"))
    s.submit_match("P2", "t2", _match(match_id="dispute", winner="P2", opponent="P1"))
    assert s.player_summary("P1")["verified_games"] == 0
    assert s.player_summary("P2")["verified_games"] == 0


def test_solo_match_never_verifies(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    s.submit_match("P1", "t1", _match(match_id="solo", winner="P1", opponent=None, is_remote=False))
    assert s.player_summary("P1")["verified_games"] == 0


def _verified_pair(s, match_id, winner, p_avg_total, p_darts):
    # Two reporters co-sign `match_id`; reporter "HI" supplies darts/total for its avg.
    s.submit_match("HI", "thi", _match(match_id=match_id, winner=winner, opponent="LO",
                                       darts=p_darts, total=p_avg_total))
    s.submit_match("LO", "tlo", _match(match_id=match_id, winner=winner, opponent="HI",
                                       darts=p_darts, total=10))


def test_leaderboard_ranks_only_verified_and_respects_min_games(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    # HI plays 3 verified matches (>= MIN_LEADERBOARD_GAMES), high avg
    for i in range(3):
        _verified_pair(s, f"v{i}", winner="HI", p_avg_total=180, p_darts=9)
    # SOLO plays 5 unverified solo matches with a huge avg — must NOT appear
    for i in range(5):
        s.submit_match("SOLO", "ts", _match(match_id=f"s{i}", winner="SOLO",
                                            opponent=None, is_remote=False, darts=3, total=180))
    board = s.leaderboard(metric="avg", limit=10)
    ids = [e["id"] for e in board]
    assert "HI" in ids            # 3 verified games, qualifies
    assert "SOLO" not in ids      # solo never verifies -> excluded from ranking
    hi = next(e for e in board if e["id"] == "HI")
    assert hi["three_dart_avg"] == 60.0  # 180 scored / 9 darts * 3
    # NOTE: "LO" also legitimately qualifies (it co-signed 3 verified matches); we
    # don't assert on LO here on purpose.


def test_counts_reports_players_and_distinct_matches(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    s.submit_match("P1", "t1", _match(match_id="m1"))
    s.submit_match("P2", "t2", _match(match_id="m1", opponent="P1"))  # same match, 2 reporters
    s.submit_match("P1", "t1", _match(match_id="m2"))
    c = s.counts()
    assert c["players"] == 2
    assert c["matches"] == 2  # distinct match_id
