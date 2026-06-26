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


def test_update_profile_creates_player_without_a_match(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    out = s.update_profile("P9", "tok-9", display_name="Zoe", avatar_color="#0f0", bio="  love the bull  ")
    assert out["bio"] == "love the bull"  # stripped
    summary = s.player_summary("P9")
    assert summary["games_played"] == 0
    assert summary["display_name"] == "Zoe"
    assert summary["bio"] == "love the bull"


def test_update_profile_wrong_token_rejected(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    s.update_profile("P1", "tok-1", bio="first")
    with pytest.raises(PermissionError):
        s.update_profile("P1", "WRONG", bio="hijack")


def test_update_profile_rejects_overlong_bio(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    with pytest.raises(ValidationError):
        s.update_profile("P1", "tok-1", bio="x" * 161)


def test_empty_bio_stores_null(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    s.update_profile("P1", "tok-1", display_name="Al", bio="   ")
    assert s.player_summary("P1")["bio"] is None


def test_bio_persists_across_match_submit(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    s.update_profile("P1", "tok-1", bio="checkout king")
    s.submit_match("P1", "tok-1", _match())  # submit must not wipe bio
    assert s.player_summary("P1")["bio"] == "checkout king"


def _match_at(match_id, started, opponent="P2", winner="P1", darts=9, total=180):
    m = _match(match_id=match_id, opponent=opponent, winner=winner, darts=darts, total=total)
    m["started_at"] = started
    return m


def test_recent_matches_newest_first_with_opponent_name(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    s.update_profile("OPP", "topp", display_name="Opie")          # give the opponent a name
    s.submit_match("P1", "t1", _match_at("a", "2026-05-24T10:00:00.000Z", opponent="OPP", winner="P1"))
    s.submit_match("P1", "t1", _match_at("b", "2026-05-25T10:00:00.000Z", opponent="OPP", winner="OPP"))
    rows = s.recent_matches("P1")
    assert [r["match_id"] for r in rows] == ["b", "a"]            # newest first
    assert rows[0]["won"] is False and rows[1]["won"] is True
    assert rows[0]["opponent_name"] == "Opie"
    assert rows[1]["three_dart_avg"] == 60.0                       # 180/9*3


def test_recent_matches_limit_and_offset(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    for i in range(5):
        s.submit_match("P1", "t1", _match_at(f"m{i}", f"2026-05-2{i}T10:00:00.000Z"))
    page1 = s.recent_matches("P1", limit=2, offset=0)
    page2 = s.recent_matches("P1", limit=2, offset=2)
    assert [r["match_id"] for r in page1] == ["m4", "m3"]
    assert [r["match_id"] for r in page2] == ["m2", "m1"]


def test_recent_matches_empty_for_unknown(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    assert s.recent_matches("nobody") == []


def test_head_to_head_counts_verified_wins_and_pending(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    # Two co-signed (verified) A-vs-B matches: A wins g1, B wins g2.
    s.submit_match("A", "ta", _match(match_id="g1", winner="A", opponent="B"))
    s.submit_match("B", "tb", _match(match_id="g1", winner="A", opponent="A"))  # verifies g1 (A won)
    s.submit_match("A", "ta", _match(match_id="g2", winner="B", opponent="B"))
    s.submit_match("B", "tb", _match(match_id="g2", winner="B", opponent="A"))  # verifies g2 (B won)
    s.submit_match("A", "ta", _match(match_id="g3", winner="A", opponent="B"))  # pending (B never co-signs)
    h = s.head_to_head("A", "B")
    assert h["games"] == 2 and h["a_wins"] == 1 and h["b_wins"] == 1
    assert h["pending"] == 1
    assert h["last_played"] is not None


def test_head_to_head_self_and_unknown_are_zero(tmp_path):
    s = StatsStore(tmp_path / "stats.db")
    s.submit_match("A", "ta", _match(match_id="g1", winner="A", opponent="B"))
    assert s.head_to_head("A", "A") == {"a": "A", "b": "A", "games": 0, "a_wins": 0,
                                        "b_wins": 0, "last_played": None, "pending": 0}
    z = s.head_to_head("X", "Y")
    assert z["games"] == 0 and z["pending"] == 0 and z["last_played"] is None
