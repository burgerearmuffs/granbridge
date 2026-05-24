"""granbridge_broker.stats — SQLite-backed, identity-keyed match stats.

Keyed by the player's public UUID. Writes are authorized by a private
write-token (trust-on-first-use: the first writer for an id registers
sha256(token); later writes must match). Aggregate stats come from per-match
summary columns; per-throw rows are stored only when supplied (heatmap).
"""
from __future__ import annotations

import hashlib
import hmac
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

MAX_DARTS = 5000
MAX_DART_SCORE = 60       # T20; bounds 3-dart avg to <= 180
MAX_THROWS = 2000
MIN_LEADERBOARD_GAMES = 3


class ValidationError(ValueError):
    """Raised when a submitted match record is malformed or implausible."""


def _utc_now() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def validate_match(match: object) -> None:
    """Raise ValidationError unless `match` is a plausible, well-formed record."""
    if not isinstance(match, dict):
        raise ValidationError("match must be an object")
    mid = match.get("match_id")
    if not isinstance(mid, str) or not (1 <= len(mid) <= 128):
        raise ValidationError("bad match_id")
    mode = match.get("mode")
    if not isinstance(mode, str) or not (1 <= len(mode) <= 32):
        raise ValidationError("bad mode")
    darts = match.get("darts")
    total = match.get("total_scored")
    if isinstance(darts, bool) or not isinstance(darts, int) or not (0 <= darts <= MAX_DARTS):
        raise ValidationError("bad darts")
    if isinstance(total, bool) or not isinstance(total, int) or not (0 <= total <= darts * MAX_DART_SCORE):
        raise ValidationError("total_scored exceeds plausible max")
    if not isinstance(match.get("is_remote"), bool):
        raise ValidationError("bad is_remote")
    for key in ("opponent_id", "winner_id"):
        v = match.get(key)
        if v is not None and (not isinstance(v, str) or len(v) > 64):
            raise ValidationError(f"bad {key}")
    started = match.get("started_at")
    if not isinstance(started, str) or not (1 <= len(started) <= 40):
        raise ValidationError("bad started_at")   # required: NOT NULL column + direct access below
    ended = match.get("ended_at")
    if ended is not None and (not isinstance(ended, str) or len(ended) > 40):
        raise ValidationError("bad ended_at")
    throws = match.get("throws")
    if throws is not None:
        if not isinstance(throws, list) or len(throws) > MAX_THROWS:
            raise ValidationError("bad throws list")
        for t in throws:
            if not isinstance(t, dict):
                raise ValidationError("bad throw")
            bed = t.get("bed")
            score = t.get("score")
            if not isinstance(bed, str) or not (1 <= len(bed) <= 8):
                raise ValidationError("bad bed")
            if isinstance(score, bool) or not isinstance(score, int) or not (0 <= score <= MAX_DART_SCORE):
                raise ValidationError("bad throw score")


class StatsStore:
    """SQLite store for per-identity match stats. New connection per call (WAL)."""

    def __init__(self, db_path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_tables()

    def _init_tables(self) -> None:
        with _connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS players (
                    id TEXT PRIMARY KEY,
                    token_hash TEXT NOT NULL,
                    display_name TEXT,
                    avatar_color TEXT,
                    first_seen TEXT NOT NULL,
                    last_seen TEXT NOT NULL
                )""")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS matches (
                    match_id TEXT NOT NULL,
                    reporter_id TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    opponent_id TEXT,
                    winner_id TEXT,
                    is_remote INTEGER NOT NULL,
                    darts INTEGER NOT NULL,
                    total_scored INTEGER NOT NULL,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    verified INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (match_id, reporter_id)
                )""")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS match_throws (
                    match_id TEXT NOT NULL,
                    reporter_id TEXT NOT NULL,
                    bed TEXT NOT NULL,
                    score INTEGER NOT NULL,
                    ts TEXT NOT NULL
                )""")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_matches_reporter ON matches(reporter_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_matches_verified ON matches(verified)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_throws_reporter ON match_throws(reporter_id)")
            conn.commit()

    def submit_match(self, player_id: str, write_token: str, match: object,
                     display_name: str = "", avatar_color: str = "") -> dict:
        """Validate + record a match for player_id.

        Returns {"match_id", "verified"}. Raises ValidationError on bad data,
        PermissionError on token mismatch. Idempotent on (match_id, reporter_id).
        """
        validate_match(match)
        token_hash = _sha256(write_token)
        now = _utc_now()
        with _connect(self.db_path) as conn:
            row = conn.execute("SELECT token_hash FROM players WHERE id = ?", (player_id,)).fetchone()
            if row is None:
                conn.execute(
                    "INSERT INTO players (id, token_hash, display_name, avatar_color, first_seen, last_seen)"
                    " VALUES (?, ?, ?, ?, ?, ?)",
                    (player_id, token_hash, display_name, avatar_color, now, now),
                )
            else:
                if not hmac.compare_digest(row["token_hash"], token_hash):
                    raise PermissionError("token_mismatch")
                conn.execute(
                    "UPDATE players SET display_name = ?, avatar_color = ?, last_seen = ? WHERE id = ?",
                    (display_name, avatar_color, now, player_id),
                )
            conn.execute("""
                INSERT INTO matches (match_id, reporter_id, mode, opponent_id, winner_id,
                                     is_remote, darts, total_scored, started_at, ended_at, verified)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                ON CONFLICT(match_id, reporter_id) DO UPDATE SET
                    mode=excluded.mode, opponent_id=excluded.opponent_id,
                    winner_id=excluded.winner_id, is_remote=excluded.is_remote,
                    darts=excluded.darts, total_scored=excluded.total_scored,
                    started_at=excluded.started_at, ended_at=excluded.ended_at
            """, (match["match_id"], player_id, match["mode"], match.get("opponent_id"),
                  match.get("winner_id"), 1 if match["is_remote"] else 0, match["darts"],
                  match["total_scored"], match["started_at"], match.get("ended_at")))
            conn.execute("DELETE FROM match_throws WHERE match_id = ? AND reporter_id = ?",
                         (match["match_id"], player_id))
            throws = match.get("throws") or []
            if throws:
                conn.executemany(
                    "INSERT INTO match_throws (match_id, reporter_id, bed, score, ts)"
                    " VALUES (?, ?, ?, ?, ?)",
                    [(match["match_id"], player_id, t["bed"], t["score"], t.get("ts") or now)
                     for t in throws],
                )
            verified = self._recompute_verification(conn, match["match_id"])
            conn.commit()
        return {"match_id": match["match_id"], "verified": verified}

    def _recompute_verification(self, conn, match_id: str) -> bool:
        rows = conn.execute(
            "SELECT reporter_id, winner_id FROM matches WHERE match_id = ?", (match_id,)
        ).fetchall()
        reporters = {r["reporter_id"] for r in rows}
        winners = {r["winner_id"] for r in rows}
        verified = len(reporters) >= 2 and len(winners) == 1 and None not in winners
        conn.execute("UPDATE matches SET verified = ? WHERE match_id = ?",
                     (1 if verified else 0, match_id))
        return verified

    def leaderboard(self, metric: str = "avg", limit: int = 20) -> list[dict]:
        if metric not in ("avg", "wins"):
            metric = "avg"
        limit = max(1, min(int(limit), 100))
        with _connect(self.db_path) as conn:
            rows = conn.execute("""
                SELECT m.reporter_id AS id,
                       COUNT(*) AS games,
                       SUM(CASE WHEN m.winner_id = m.reporter_id THEN 1 ELSE 0 END) AS wins,
                       COALESCE(SUM(m.darts), 0) AS darts,
                       COALESCE(SUM(m.total_scored), 0) AS total_scored,
                       p.display_name AS display_name,
                       p.avatar_color AS avatar_color
                FROM matches m
                LEFT JOIN players p ON p.id = m.reporter_id
                WHERE m.verified = 1
                GROUP BY m.reporter_id
                HAVING games >= ?
            """, (MIN_LEADERBOARD_GAMES,)).fetchall()
        out = []
        for r in rows:
            darts = r["darts"] or 0
            total = r["total_scored"] or 0
            out.append({
                "id": r["id"], "display_name": r["display_name"],
                "avatar_color": r["avatar_color"], "games": r["games"],
                "wins": r["wins"] or 0,
                "three_dart_avg": round(total / darts * 3, 2) if darts else 0.0,
            })
        out.sort(key=(lambda e: e["wins"]) if metric == "wins" else (lambda e: e["three_dart_avg"]),
                 reverse=True)
        return out[:limit]

    def counts(self) -> dict:
        with _connect(self.db_path) as conn:
            players = conn.execute("SELECT COUNT(*) AS c FROM players").fetchone()["c"]
            matches = conn.execute("SELECT COUNT(DISTINCT match_id) AS c FROM matches").fetchone()["c"]
        return {"players": players, "matches": matches}

    def player_summary(self, player_id: str) -> dict:
        with _connect(self.db_path) as conn:
            prow = conn.execute(
                "SELECT display_name, avatar_color FROM players WHERE id = ?", (player_id,)
            ).fetchone()
            agg = conn.execute("""
                SELECT COUNT(*) AS games_played,
                       SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) AS wins,
                       SUM(verified) AS verified_games,
                       COALESCE(SUM(darts), 0) AS darts,
                       COALESCE(SUM(total_scored), 0) AS total_scored
                FROM matches WHERE reporter_id = ?
            """, (player_id, player_id)).fetchone()
            heat = conn.execute(
                "SELECT bed, COUNT(*) AS cnt FROM match_throws WHERE reporter_id = ? GROUP BY bed",
                (player_id,),
            ).fetchall()
        darts = agg["darts"] or 0
        total = agg["total_scored"] or 0
        return {
            "id": player_id,
            "display_name": prow["display_name"] if prow else None,
            "avatar_color": prow["avatar_color"] if prow else None,
            "games_played": agg["games_played"] or 0,
            "wins": agg["wins"] or 0,
            "verified_games": agg["verified_games"] or 0,
            "darts": darts,
            "total_scored": total,
            "three_dart_avg": round(total / darts * 3, 2) if darts else 0.0,
            "heatmap": {r["bed"]: r["cnt"] for r in heat},
        }
