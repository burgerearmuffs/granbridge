# Server-Side Stats — Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a SQLite-backed, identity-keyed stats store to the existing broker — `stats_submit` over WebSocket (writes) plus `GET /stats/player/{id}` and `GET /stats/leaderboard` (reads) — with trust-on-first-use token auth, sanity caps, and co-signed-match verification.

**Architecture:** A new `granbridge_broker/stats.py` (`StatsStore`, SQLite, connection-per-call, WAL) wired into the broker. All DB work runs via `asyncio.to_thread` so it never stalls signaling. Writes ride a WS message (`process_request` cannot read an HTTP body in websockets 15); reads are plain HTTP GET on the same port. Stats are keyed by the player's **public UUID**; writes are authorized by a **private write-token** (TOFU: first writer for an id registers `sha256(token)`).

**Tech Stack:** Python 3.14, `websockets==15.0.1` (asyncio server, async `process_request`), SQLite (stdlib `sqlite3`), pytest + pytest-asyncio (`asyncio_mode=auto`), Docker Compose.

**This is plan 1 of 2.** Plan 2 (client integration: app `export/latest`, UI identity/recovery-key/match-id/stats-client/offline-queue, Profile/Multiplayer/Leaderboard surfaces, upload toggle) is written after this lands. This plan delivers a working, independently-testable, deployable stats backend.

**Spec:** `docs/superpowers/specs/2026-05-24-server-side-stats-design.md`. Refinements made here (vs. spec), all inside the approved "embed in broker" architecture:
1. **Writes are a WS `stats_submit` message, not `POST /stats/submit`** — websockets 15's `Request` exposes no body (`http11.py:90,117`), so a POST body is unreadable on the broker's single port. Reads stay HTTP GET.
2. **`matches` carries summary columns (`darts`, `total_scored`); `throws` is optional.** Aggregate stats come from the match-level summary, so a remote guest can submit an aggregate contribution (assembled from `game_state`) **without** server-side guest recording — this resolves the spec's flagged "guest recording" Open Item cheaply. Per-throw `match_throws` is stored only when supplied (heatmap fidelity), e.g. local solo play.

**Working directory:** repo root `C:\Users\willa\granbridge`. Branch: `server-side-stats`. Run tests from the repo root: `python -m pytest server/tests -q`.

---

## File Structure

- **Create** `server/granbridge_broker/stats.py` — `StatsStore` (schema, `submit_match`, verification, `player_summary`, `leaderboard`, `counts`) + `validate_match` / `ValidationError`. One responsibility: stats persistence + validation. No broker/websocket imports.
- **Create** `server/tests/test_stats_store.py` — unit tests for the store + validation (no network).
- **Create** `server/tests/test_stats_api.py` — integration tests over a real broker (WS submit + HTTP GET reads).
- **Modify** `server/granbridge_broker/config.py` — add `stats_db_path`, `stats_rate_per_min`.
- **Modify** `server/granbridge_broker/broker.py` — async `_process_request`; `/stats/*` GET routes; `stats_submit` WS message; `/healthz` counts; `StatsStore` wiring.
- **Modify** `server/granbridge_broker/__main__.py` — build `StatsStore` from config and pass it in.
- **Modify** `server/tests/test_config.py` — assert the new config fields.
- **Modify** `server/docker-compose.yml` — `data` named volume + `STATS_DB_PATH`/`STATS_RATE_PER_MIN` env on the broker.
- **Modify** `server/.env.example` — document the new env vars.
- **Modify** `server/smoke.py` — add a `/stats/*` round-trip check.
- **Modify** `server/README.md` — document the stats store, the `data` volume, and a backup note.

---

## Task 1: StatsStore — schema, TOFU token, submit_match

**Files:**
- Create: `server/granbridge_broker/stats.py`
- Test: `server/tests/test_stats_store.py`

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest server/tests/test_stats_store.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'granbridge_broker.stats'`

- [ ] **Step 3: Write minimal implementation**

```python
# server/granbridge_broker/stats.py
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
    for key in ("started_at", "ended_at"):
        v = match.get(key)
        if v is not None and (not isinstance(v, str) or len(v) > 40):
            raise ValidationError(f"bad {key}")
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest server/tests/test_stats_store.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add server/granbridge_broker/stats.py server/tests/test_stats_store.py
git commit -m "feat(server): StatsStore — schema, TOFU token auth, submit_match + player_summary"
```

---

## Task 2: StatsStore — verification of co-signed matches

**Files:**
- Modify: `server/granbridge_broker/stats.py` (already has `_recompute_verification` from Task 1 — this task adds the tests that pin its behavior)
- Test: `server/tests/test_stats_store.py`

- [ ] **Step 1: Write the failing test**

```python
# append to server/tests/test_stats_store.py
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
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `python -m pytest server/tests/test_stats_store.py -q`
Expected: PASS — `_recompute_verification` from Task 1 already implements this. (If any fail, fix `_recompute_verification` until green; the tests are the spec for it.)

- [ ] **Step 3: (only if Step 2 failed) adjust `_recompute_verification`**

No change expected. If `test_disagreeing_winners_stay_unverified` fails, confirm the `len(winners) == 1` guard; if `test_solo_match_never_verifies` fails, confirm `len(reporters) >= 2`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest server/tests/test_stats_store.py -q`
Expected: PASS (7 passed total)

- [ ] **Step 5: Commit**

```bash
git add server/tests/test_stats_store.py server/granbridge_broker/stats.py
git commit -m "test(server): pin co-signed match verification (agree/dispute/solo)"
```

---

## Task 3: StatsStore — leaderboard (verified-only) + counts

**Files:**
- Modify: `server/granbridge_broker/stats.py`
- Test: `server/tests/test_stats_store.py`

- [ ] **Step 1: Write the failing test**

```python
# append to server/tests/test_stats_store.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest server/tests/test_stats_store.py -q`
Expected: FAIL — `AttributeError: 'StatsStore' object has no attribute 'leaderboard'`

- [ ] **Step 3: Add `leaderboard` and `counts` to `StatsStore`**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest server/tests/test_stats_store.py -q`
Expected: PASS (9 passed total)

- [ ] **Step 5: Commit**

```bash
git add server/granbridge_broker/stats.py server/tests/test_stats_store.py
git commit -m "feat(server): StatsStore.leaderboard (verified-only, min-games) + counts"
```

---

## Task 4: Config — stats_db_path + stats_rate_per_min

**Files:**
- Modify: `server/granbridge_broker/config.py`
- Test: `server/tests/test_config.py`

- [ ] **Step 1: Write the failing test**

```python
# append to server/tests/test_config.py
from granbridge_broker.config import from_env


def test_stats_config_defaults_disabled(tmp_path):
    cfg = from_env({"DOMAIN": "x.test", "TURN_SECRET": "s"})
    assert cfg.stats_db_path == ""           # empty => stats disabled
    assert cfg.stats_rate_per_min == 30


def test_stats_config_from_env(tmp_path):
    cfg = from_env({"DOMAIN": "x.test", "TURN_SECRET": "s",
                    "STATS_DB_PATH": "/data/stats.db", "STATS_RATE_PER_MIN": "5"})
    assert cfg.stats_db_path == "/data/stats.db"
    assert cfg.stats_rate_per_min == 5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest server/tests/test_config.py -q`
Expected: FAIL — `AttributeError: 'BrokerConfig' object has no attribute 'stats_db_path'`

- [ ] **Step 3: Add the fields to `BrokerConfig` and `from_env`**

In `server/granbridge_broker/config.py`, add to the `BrokerConfig` dataclass (after `msg_rate_per_sec`):

```python
    stats_db_path: str
    stats_rate_per_min: int
```

And in `from_env`, add to the returned `BrokerConfig(...)` call (after `msg_rate_per_sec=...`):

```python
        stats_db_path=env.get("STATS_DB_PATH", ""),
        stats_rate_per_min=int(env.get("STATS_RATE_PER_MIN", "30")),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest server/tests/test_config.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/granbridge_broker/config.py server/tests/test_config.py
git commit -m "feat(server): config — STATS_DB_PATH + STATS_RATE_PER_MIN"
```

---

## Task 5: Broker — make `_process_request` async (no behavior change)

This refactor lets later tasks `await` DB work. Existing `/turn`, `/healthz`, origin, and conn-rate behavior must be unchanged. `_http_route` stays synchronous (Task 1-style tests in `test_http.py` call it directly).

**Files:**
- Modify: `server/granbridge_broker/broker.py`
- Test: `server/tests/test_broker.py`, `server/tests/test_http.py` (must stay green)

- [ ] **Step 1: Make `_process_request` a coroutine**

In `server/granbridge_broker/broker.py`, change the signature and keep the body identical otherwise:

```python
    async def _process_request(self, connection, request):
        ip = client_ip(request.headers, connection.remote_address)
        resp = self._http_route(request.path.split("?", 1)[0], ip)
        if resp is not None:
            return resp
        if not self._conn_limiter.allow(ip, self._clock()):
            self._log.warning("rate-limited WS upgrade ip=%s", ip)
            return json_response(429, {"error": "rate_limited"}, reason="Too Many Requests")
        if self._allowed_origins is not None:
            origin = request.headers.get("Origin")
            if not origin_allowed(origin, self._allowed_origins):
                self._log.warning("rejected WS upgrade: forbidden origin %r", origin)
                return json_response(403, {"error": "forbidden_origin"}, reason="Forbidden")
        return None
```

(Note: `request.path` now split on `?` before route matching so query strings don't break `/healthz`/`/turn`; previously paths had no query. This is safe.)

- [ ] **Step 2: Run the existing broker + http tests to verify still green**

Run: `python -m pytest server/tests/test_broker.py server/tests/test_http.py server/tests/test_rate_limits.py -q`
Expected: PASS — websockets 15 awaits an awaitable `process_request` (`asyncio/server.py:148`), so making it async is transparent.

- [ ] **Step 3: (no new code)**

- [ ] **Step 4: Re-run to confirm**

Run: `python -m pytest server/tests -q`
Expected: PASS (all existing + Tasks 1-4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/granbridge_broker/broker.py
git commit -m "refactor(server): make broker _process_request async (no behavior change)"
```

---

## Task 6: Broker — wire StatsStore + `/stats/*` GET reads

**Files:**
- Modify: `server/granbridge_broker/broker.py`
- Test: `server/tests/test_stats_api.py`

- [ ] **Step 1: Write the failing test**

```python
# server/tests/test_stats_api.py
import json
import urllib.request
import pytest
import websockets
from granbridge_broker.broker import BrokerServer
from granbridge_broker.stats import StatsStore


async def _start(tmp_path, port):
    store = StatsStore(tmp_path / "stats.db")
    s = BrokerServer("127.0.0.1", port, turn_secret="sek", turn_domain="x.test",
                     stats_store=store, stats_rate_per_min=1000)
    await s.start()
    return s, store


def _get(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as r:
        return r.status, json.loads(r.read())


@pytest.mark.asyncio
async def test_stats_player_read_returns_zeros_for_unknown(tmp_path):
    s, _ = await _start(tmp_path, 8801)
    try:
        status, body = _get(8801, "/stats/player/nobody")
        assert status == 200
        assert body["games_played"] == 0 and body["three_dart_avg"] == 0.0
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_stats_player_read_reflects_a_submitted_match(tmp_path):
    s, store = await _start(tmp_path, 8802)
    try:
        store.submit_match("P1", "t1", {
            "match_id": "m1", "mode": "x01", "opponent_id": None, "winner_id": "P1",
            "is_remote": False, "darts": 9, "total_scored": 180,
            "started_at": "2026-05-24T10:00:00.000Z", "ended_at": "2026-05-24T10:05:00.000Z",
            "throws": None,
        })
        status, body = _get(8802, "/stats/player/P1")
        assert status == 200 and body["games_played"] == 1 and body["wins"] == 1
        status, lb = _get(8802, "/stats/leaderboard?metric=avg&limit=5")
        assert status == 200 and lb["metric"] == "avg" and isinstance(lb["players"], list)
    finally:
        await s.stop()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest server/tests/test_stats_api.py -q`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'stats_store'`

- [ ] **Step 3: Wire StatsStore + GET routes in the broker**

In `server/granbridge_broker/broker.py`:

Add imports at top:

```python
from urllib.parse import urlparse, parse_qs

from granbridge_broker.stats import StatsStore, ValidationError
```

Add constructor params (in `__init__` signature, after `msg_rate_per_sec`):

```python
        stats_store: "StatsStore | None" = None,
        stats_rate_per_min: int = 0,
```

Add to `__init__` body (after `self._msg_limiter = ...`):

```python
        self._stats = stats_store
        self._stats_limiter = RateLimiter(stats_rate_per_min, 60.0)
```

Extend `_process_request` (insert at the very top of the method body, before the existing `resp = self._http_route(...)` block):

```python
        path_only = request.path.split("?", 1)[0]
        if self._stats is not None and path_only.startswith("/stats/"):
            if not self._stats_limiter.allow(ip, self._clock()):
                return json_response(429, {"error": "rate_limited"}, reason="Too Many Requests")
            return await self._handle_stats_get(path_only, request.path)
        if self._stats is not None and path_only == "/healthz":
            base = {"status": "ok", "rooms": len(self._rooms), "peers": len(self._peers)}
            base.update(await asyncio.to_thread(self._stats.counts))
            return json_response(200, base)
```

(Keep the existing `resp = self._http_route(request.path.split("?", 1)[0], ip)` line from Task 5 below this; when `self._stats is None`, `/healthz` still falls through to `_http_route` as before.)

Add the reader helper method:

```python
    async def _handle_stats_get(self, path_only: str, full_path: str):
        if path_only.startswith("/stats/player/"):
            pid = path_only[len("/stats/player/"):]
            if not pid:
                return json_response(400, {"error": "missing player id"}, reason="Bad Request")
            summary = await asyncio.to_thread(self._stats.player_summary, pid)
            return json_response(200, summary)
        if path_only == "/stats/leaderboard":
            qs = parse_qs(urlparse(full_path).query)
            metric = (qs.get("metric") or ["avg"])[0]
            try:
                limit = int((qs.get("limit") or ["20"])[0])
            except ValueError:
                limit = 20
            board = await asyncio.to_thread(self._stats.leaderboard, metric, limit)
            return json_response(200, {"metric": metric, "players": board})
        return json_response(404, {"error": "not_found"}, reason="Not Found")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest server/tests/test_stats_api.py -q`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add server/granbridge_broker/broker.py server/tests/test_stats_api.py
git commit -m "feat(server): broker /stats/player + /stats/leaderboard reads + healthz counts"
```

---

## Task 7: Broker — `stats_submit` WebSocket message

**Files:**
- Modify: `server/granbridge_broker/broker.py`
- Test: `server/tests/test_stats_api.py`

- [ ] **Step 1: Write the failing test**

```python
# append to server/tests/test_stats_api.py
def _match_msg(player_id="P1", token="t1", match_id="m1", winner="P1", name="Ann"):
    return {
        "type": "stats_submit", "id": player_id, "writeToken": token,
        "player": {"id": player_id, "name": name, "avatar": {"color": "#f00"}},
        "match": {
            "match_id": match_id, "mode": "x01", "opponent_id": None, "winner_id": winner,
            "is_remote": False, "darts": 9, "total_scored": 180,
            "started_at": "2026-05-24T10:00:00.000Z", "ended_at": "2026-05-24T10:05:00.000Z",
            "throws": [{"bed": "T20", "score": 60, "ts": "2026-05-24T10:00:01.000Z"}],
        },
    }


@pytest.mark.asyncio
async def test_stats_submit_over_ws_then_read_back(tmp_path):
    s, _ = await _start(tmp_path, 8803)
    try:
        async with websockets.connect("ws://127.0.0.1:8803") as ws:
            await ws.send(json.dumps(_match_msg()))
            ack = json.loads(await ws.recv())
        assert ack["type"] == "stats_ack" and ack["match_id"] == "m1" and ack["verified"] is False
        _, body = _get(8803, "/stats/player/P1")
        assert body["games_played"] == 1 and body["heatmap"]["T20"] == 1
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_stats_submit_wrong_token_is_rejected(tmp_path):
    s, _ = await _start(tmp_path, 8804)
    try:
        async with websockets.connect("ws://127.0.0.1:8804") as ws:
            await ws.send(json.dumps(_match_msg()))
            await ws.recv()  # first ack registers the token
            await ws.send(json.dumps(_match_msg(token="WRONG", match_id="m2")))
            err = json.loads(await ws.recv())
        assert err["type"] == "error" and err["code"] == "token_mismatch"
    finally:
        await s.stop()


@pytest.mark.asyncio
async def test_stats_submit_implausible_is_rejected(tmp_path):
    s, _ = await _start(tmp_path, 8805)
    try:
        async with websockets.connect("ws://127.0.0.1:8805") as ws:
            bad = _match_msg(match_id="m3")
            bad["match"]["total_scored"] = 99999
            await ws.send(json.dumps(bad))
            err = json.loads(await ws.recv())
        assert err["type"] == "error" and err["code"] == "implausible"
    finally:
        await s.stop()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest server/tests/test_stats_api.py -q`
Expected: FAIL — submit yields `{"type":"error","code":"bad_request","message":"unknown message type..."}` (no `stats_submit` branch yet), so `ack["type"] == "stats_ack"` fails.

- [ ] **Step 3: Add the `stats_submit` branch in `_handle`**

In `server/granbridge_broker/broker.py`, inside `_handle`'s message dispatch, add a branch (place it before the `# ---- leave ----` branch). It does NOT require membership — solo submits have no room:

```python
                # ---- stats_submit -------------------------------------
                elif mtype == "stats_submit":
                    if self._stats is None:
                        await _error(ws, "unsupported", "stats not enabled")
                        continue
                    if not self._stats_limiter.allow(peer_id, self._clock()):
                        await _error(ws, "rate_limited", "too many submissions")
                        continue
                    pid = msg.get("id")
                    token = msg.get("writeToken")
                    match = msg.get("match")
                    if not isinstance(pid, str) or not pid or not isinstance(token, str) or not token:
                        await _error(ws, "bad_request", "stats_submit missing id/writeToken")
                        continue
                    player = msg.get("player") if isinstance(msg.get("player"), dict) else {}
                    name = player.get("name", "") if isinstance(player.get("name"), str) else ""
                    avatar = player.get("avatar") if isinstance(player.get("avatar"), dict) else {}
                    color = avatar.get("color", "") if isinstance(avatar.get("color"), str) else ""
                    try:
                        result = await asyncio.to_thread(
                            self._stats.submit_match, pid, token, match, name, color)
                    except ValidationError:
                        await _error(ws, "implausible", "match failed validation")
                        continue
                    except PermissionError:
                        await _error(ws, "token_mismatch", "write token does not match")
                        continue
                    await _send(ws, {"type": "stats_ack",
                                     "match_id": result["match_id"], "verified": result["verified"]})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest server/tests/test_stats_api.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add server/granbridge_broker/broker.py server/tests/test_stats_api.py
git commit -m "feat(server): stats_submit WS message (TOFU auth, validation, ack)"
```

---

## Task 8: `__main__` — build StatsStore from config

**Files:**
- Modify: `server/granbridge_broker/__main__.py`
- Test: manual smoke (covered by Task 10); no new unit test (it's wiring).

- [ ] **Step 1: Add StatsStore construction + pass-through**

In `server/granbridge_broker/__main__.py`, after `cfg = from_env()` and before constructing `BrokerServer`:

```python
    from granbridge_broker.stats import StatsStore
    stats_store = StatsStore(cfg.stats_db_path) if cfg.stats_db_path else None
```

Add the two args to the `BrokerServer(...)` call (after `msg_rate_per_sec=cfg.msg_rate_per_sec,`):

```python
        stats_store=stats_store,
        stats_rate_per_min=cfg.stats_rate_per_min,
```

And extend the startup log line to mention stats:

```python
    log.info(
        "broker listening host=%s port=%s domain=%s max_rooms=%s origins=%s stats=%s",
        cfg.host, cfg.port, cfg.turn_domain, cfg.max_rooms, cfg.allowed_origins,
        bool(stats_store),
    )
```

- [ ] **Step 2: Verify it imports and builds (no server needed)**

Run: `python -c "import sys; sys.path.insert(0,'server'); from granbridge_broker.__main__ import _main; print('ok')"`
Expected: prints `ok` (no syntax/import error).

- [ ] **Step 3: (no further code)**

- [ ] **Step 4: Run the full server suite**

Run: `python -m pytest server/tests -q`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add server/granbridge_broker/__main__.py
git commit -m "feat(server): build StatsStore from STATS_DB_PATH and wire into broker"
```

---

## Task 9: Compose — `data` volume + stats env; `.env.example`

**Files:**
- Modify: `server/docker-compose.yml`
- Modify: `server/.env.example`

- [ ] **Step 1: Add the volume + env to the broker service**

In `server/docker-compose.yml`, under the `broker:` service `environment:` block, add:

```yaml
      STATS_DB_PATH: "/data/stats.db"
      STATS_RATE_PER_MIN: "${STATS_RATE_PER_MIN:-30}"
```

Under the `broker:` service `volumes:` block, add (alongside `- secrets:/secrets:ro`):

```yaml
      - data:/data
```

At the bottom `volumes:` block (alongside `secrets:`), add:

```yaml
  data:
```

- [ ] **Step 2: Add to `.env.example`**

Append to `server/.env.example`:

```bash
# Server-side stats (set STATS_DB_PATH empty to disable). Default rate limit:
STATS_RATE_PER_MIN=30
```

- [ ] **Step 3: Validate compose syntax**

Run: `docker compose -f server/docker-compose.yml config --quiet && echo COMPOSE_OK`
Expected: `COMPOSE_OK` (no error). If docker is unavailable in the dev env, eyeball the YAML indentation against the existing `secrets:` volume entry instead.

- [ ] **Step 4: (no tests)**

- [ ] **Step 5: Commit**

```bash
git add server/docker-compose.yml server/.env.example
git commit -m "feat(server): persist stats on a data volume; STATS_* env"
```

---

## Task 10: smoke.py — `/stats/*` round-trip check

**Files:**
- Modify: `server/smoke.py`
- Test: `server/tests/test_stats_api.py` (add a test that drives `check_stats`)

- [ ] **Step 1: Write the failing test**

```python
# append to server/tests/test_stats_api.py
from smoke import check_stats  # noqa: E402


@pytest.mark.asyncio
async def test_smoke_check_stats_round_trip(tmp_path):
    s, _ = await _start(tmp_path, 8806)
    try:
        ok, detail = await check_stats("ws://127.0.0.1:8806", "http://127.0.0.1:8806")
        assert ok is True
        assert "stats" in detail
    finally:
        await s.stop()
```

(`smoke.py` is at `server/smoke.py`; `conftest.py` already puts `server/` on `sys.path`, so `from smoke import check_stats` resolves.)

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest server/tests/test_stats_api.py::test_smoke_check_stats_round_trip -q`
Expected: FAIL — `ImportError: cannot import name 'check_stats' from 'smoke'`

- [ ] **Step 3: Add `check_stats` to `smoke.py` and call it in `run`**

Add this function (after `check_ws`):

```python
async def check_stats(ws_url: str, http_base: str) -> tuple[bool | None, str]:
    """Submit a throwaway match over WS, then read it back via GET /stats/player/<id>."""
    try:
        import websockets
    except ImportError:
        return None, "stats: SKIPPED (install 'websockets' to enable this check)"
    import uuid as _uuid
    pid = "smoke-" + _uuid.uuid4().hex[:8]
    match = {
        "match_id": "smoke-" + _uuid.uuid4().hex[:8], "mode": "x01",
        "opponent_id": None, "winner_id": pid, "is_remote": False,
        "darts": 9, "total_scored": 180,
        "started_at": "2026-01-01T00:00:00.000Z", "ended_at": "2026-01-01T00:05:00.000Z",
        "throws": None,
    }
    try:
        async with websockets.connect(ws_url, open_timeout=5) as ws:
            await ws.send(json.dumps({"type": "stats_submit", "id": pid, "writeToken": "smoke",
                                      "player": {"id": pid, "name": pid}, "match": match}))
            ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        if ack.get("type") == "error" and ack.get("code") == "unsupported":
            return None, "stats: SKIPPED (broker has stats disabled)"
        if ack.get("type") != "stats_ack":
            return False, f"stats submit: unexpected reply {ack.get('type')}"
        with urllib.request.urlopen(http_base + "/stats/player/" + pid, timeout=5) as resp:
            body = json.loads(resp.read())
        ok = body.get("games_played") == 1
        return ok, f"stats: submit+read round-trip games_played={body.get('games_played')}"
    except Exception as exc:
        return False, f"stats: {exc}"
```

In `run`, append the stats check to `results` after the `check_ws` line:

```python
    results.append(await check_stats(ws_url, base))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest server/tests/test_stats_api.py -q`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add server/smoke.py server/tests/test_stats_api.py
git commit -m "feat(server): smoke.py stats round-trip check (WS submit + GET read)"
```

---

## Task 11: Docker-gated integration test (real volume) + docs

**Files:**
- Create: `server/tests/test_stats_integration.py`
- Modify: `server/README.md`

- [ ] **Step 1: Write the integration test (gated like the coturn one)**

```python
# server/tests/test_stats_integration.py
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `python -m pytest server/tests/test_stats_integration.py -q`
Expected: PASS (1 passed)

- [ ] **Step 3: Document in `server/README.md`**

Add a `## Stats` section to `server/README.md` documenting:
- the `stats_submit` WS message + `GET /stats/player/{id}` + `GET /stats/leaderboard` contract (copy the wire shapes from this plan);
- that stats live in SQLite on the `data` volume (`STATS_DB_PATH=/data/stats.db`), keyed by the player's public UUID, authorized by a private write-token (TOFU);
- backup: "stats are in the `data` volume; to back up, `docker compose cp broker:/data/stats.db ./stats-backup.db` (or copy the named volume). No automated backup is configured.";
- `STATS_RATE_PER_MIN` env (default 30; set `STATS_DB_PATH` empty to disable stats entirely).

- [ ] **Step 4: Run the full server suite**

Run: `python -m pytest server/tests -q`
Expected: PASS (all: existing + ~16 new stats tests)

- [ ] **Step 5: Commit**

```bash
git add server/tests/test_stats_integration.py server/README.md
git commit -m "test(server): stats persistence across reopen; docs(server): stats + backup"
```

---

## Task 12: BUILD-LOG + TARGET-FEATURES updates

**Files:**
- Modify: `docs/BUILD-LOG.md`
- Modify: `docs/TARGET-FEATURES.md`

- [ ] **Step 1: Append a BUILD-LOG entry**

Add a dated entry to `docs/BUILD-LOG.md` summarizing: server-side stats backend — `StatsStore` (SQLite on a `data` volume), `stats_submit` WS write + `/stats/player/{id}` & `/stats/leaderboard` GET reads, TOFU write-token auth, sanity caps, verified-only leaderboard via co-signed `match_id`. Note refinements (WS submit instead of POST; optional throws + summary columns resolving the guest-recording item). Note: client integration is Plan 2.

- [ ] **Step 2: Bump TARGET-FEATURES status**

In `docs/TARGET-FEATURES.md`, update section **D. Player profiles + identity**: mark server-side per-identity stats store as built (backend), note recovery-key identity. Add a line under **E. Streaming & social** for the leaderboard (backend built; UI in Plan 2). Keep client-facing items (cross-device card, opponent card from server, leaderboard view) as ◐/○ pending Plan 2.

- [ ] **Step 3: (no tests)**

- [ ] **Step 4: Final full suite**

Run: `python -m pytest server/tests -q` and `python -m pytest -q` (root app suite, to confirm no regressions)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/BUILD-LOG.md docs/TARGET-FEATURES.md
git commit -m "docs: BUILD-LOG + TARGET-FEATURES for server-side stats backend"
```

---

## Self-Review (completed during planning)

**Spec coverage:** Identity/TOFU token → Tasks 1,7. Schema/ingestion (archive) → Tasks 1,3. My-stats query → Tasks 1,6. Opponent card data source (`GET /stats/player/{id}`) → Task 6. Leaderboard (verified-only, min-games) → Tasks 3,6. Trust/verification (co-signed match_id) → Task 2. Sanity caps → Task 1. Concurrency (async `process_request` + `to_thread`) → Tasks 5,6,7. Ops (volume, env, smoke, healthz counts) → Tasks 6,8,9,10. Tests (unit/API/integration) → Tasks 1-3,6,7,10,11. **Deferred to Plan 2 (client):** app `export/latest`, UI identity/recovery-key/match-id/stats-client/offline-queue, Profile/Multiplayer/Leaderboard surfaces, upload toggle — out of scope for the backend plan by design.

**Placeholder scan:** none — every code/test step contains complete code; the only "fill-in-prose" steps are the docs tasks (11 Step 3, 12), which enumerate exact content.

**Type/name consistency:** `submit_match(player_id, write_token, match, display_name, avatar_color)` → returns `{"match_id","verified"}`; consumed identically in broker Task 7 and smoke Task 10. `player_summary` keys (`games_played, wins, verified_games, darts, total_scored, three_dart_avg, heatmap, display_name, avatar_color, id`) are produced in Task 1 and asserted in Tasks 6,7,11. `leaderboard(metric, limit)` shape (`{metric, players:[{id,display_name,avatar_color,games,wins,three_dart_avg}]}`) produced Task 3, wrapped Task 6, asserted Task 6. WS `stats_submit`/`stats_ack` and error codes (`token_mismatch`, `implausible`, `unsupported`, `rate_limited`) consistent across Tasks 7,10. Config fields `stats_db_path`/`stats_rate_per_min` consistent across Tasks 4,8.
