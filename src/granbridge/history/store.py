from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


class HistoryStore:
    """SQLite-backed store for match history. Thread-safe: opens a new connection per call."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_tables()

    def _init_tables(self) -> None:
        with _connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS games (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    mode TEXT NOT NULL,
                    players_json TEXT NOT NULL,
                    options_json TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    winner TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS throws (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_id INTEGER NOT NULL,
                    player TEXT NOT NULL,
                    bed TEXT NOT NULL,
                    score INTEGER NOT NULL,
                    ts TEXT NOT NULL
                )
            """)
            conn.commit()

    def start_game(self, mode: str, players: list[str], options: dict) -> int:
        """Insert a new game row; returns the new game_id."""
        with _connect(self.db_path) as conn:
            cur = conn.execute(
                "INSERT INTO games (mode, players_json, options_json, started_at) VALUES (?, ?, ?, ?)",
                (mode, json.dumps(players), json.dumps(options), _utc_now()),
            )
            conn.commit()
            return cur.lastrowid  # type: ignore[return-value]

    def record_throw(self, game_id: int, player: str, bed: str, score: int) -> None:
        """Record a single dart throw."""
        with _connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO throws (game_id, player, bed, score, ts) VALUES (?, ?, ?, ?, ?)",
                (game_id, player, bed, score, _utc_now()),
            )
            conn.commit()

    def end_game(self, game_id: int, winner: Optional[str]) -> None:
        """Mark a game as finished and record the winner."""
        with _connect(self.db_path) as conn:
            conn.execute(
                "UPDATE games SET ended_at = ?, winner = ? WHERE id = ?",
                (_utc_now(), winner, game_id),
            )
            conn.commit()

    def recent_games(self, limit: int = 20) -> list[dict]:
        """Return the most recent games, newest first."""
        with _connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM games ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]

    def player_stats(self) -> list[dict]:
        """Return per-player aggregated stats across all recorded games."""
        with _connect(self.db_path) as conn:
            rows = conn.execute("""
                SELECT
                    t.player,
                    COUNT(DISTINCT t.game_id) AS games_played,
                    (
                        SELECT COUNT(*)
                        FROM games g2
                        WHERE g2.winner = t.player
                    ) AS wins,
                    COUNT(*) AS darts,
                    SUM(t.score) AS total_scored
                FROM throws t
                GROUP BY t.player
            """).fetchall()
            result = []
            for r in rows:
                darts = r["darts"] or 0
                total = r["total_scored"] or 0
                avg = round(total / darts * 3, 2) if darts else 0.0
                result.append({
                    "player": r["player"],
                    "games_played": r["games_played"],
                    "wins": r["wins"] or 0,
                    "darts": darts,
                    "total_scored": total,
                    "three_dart_avg": avg,
                })
            return result

    def hit_counts(self, game_id: Optional[int] = None) -> dict[str, int]:
        """Return bed -> count across all throws, optionally scoped to a single game."""
        with _connect(self.db_path) as conn:
            if game_id is not None:
                rows = conn.execute(
                    "SELECT bed, COUNT(*) AS cnt FROM throws WHERE game_id = ? GROUP BY bed",
                    (game_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT bed, COUNT(*) AS cnt FROM throws GROUP BY bed",
                ).fetchall()
            return {r["bed"]: r["cnt"] for r in rows}
