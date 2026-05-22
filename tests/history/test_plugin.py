from __future__ import annotations

import pytest
from pathlib import Path

from granbridge.events.models import DartHit, Ring
from granbridge.game.events import GameStarted, GameStateEvent
from granbridge.game.models import GameState, GameStatus, Player
from granbridge.history.plugin import HistoryPlugin
from granbridge.history.store import HistoryStore


def _make_store(tmp_path: Path) -> HistoryStore:
    return HistoryStore(tmp_path / "history.db")


def _player(pid: str, name: str) -> Player:
    return Player(id=pid, name=name)


def _game_state_event(players: list[Player], active_index: int, status: GameStatus, winner: str | None = None) -> GameStateEvent:
    state = GameState(
        mode="x01",
        status=status,
        players=players,
        active_index=active_index,
        winner=winner,
    )
    return GameStateEvent(state=state)


def _dart_hit_event(bed: str, score: int) -> DartHit:
    return DartHit(raw=bed, ring=Ring.TRIPLE, segment=20, multiplier=3, bed=bed, score=score)


@pytest.mark.asyncio
async def test_game_is_recorded(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    plugin = HistoryPlugin({}, store)

    players = [_player("p1", "Alice"), _player("p2", "Bob")]

    # 1. Game starts
    await plugin.handle(GameStarted(mode="x01", players=players, options={"legs": 3}))

    # 2. Game state: Alice is active (index 0)
    await plugin.handle(_game_state_event(players, active_index=0, status=GameStatus.IN_PROGRESS))

    # 3. Alice throws T20
    await plugin.handle(_dart_hit_event("T20", 60))

    # 4. Game state: finished, Alice wins (winner is player id "p1")
    await plugin.handle(_game_state_event(players, active_index=0, status=GameStatus.FINISHED, winner="p1"))

    # Assertions
    games = store.recent_games()
    assert len(games) == 1
    g = games[0]
    assert g["mode"] == "x01"
    assert g["winner"] == "Alice"  # id "p1" resolved to name "Alice"
    assert g["ended_at"] is not None

    # One throw recorded
    import sqlite3
    conn = sqlite3.connect(str(tmp_path / "history.db"))
    conn.row_factory = sqlite3.Row
    throws = conn.execute("SELECT * FROM throws").fetchall()
    conn.close()

    assert len(throws) == 1
    t = throws[0]
    assert t["player"] == "Alice"
    assert t["bed"] == "T20"
    assert t["score"] == 60


@pytest.mark.asyncio
async def test_no_game_no_throw_recorded(tmp_path: Path) -> None:
    """Dart hits before game_started are silently ignored."""
    store = _make_store(tmp_path)
    plugin = HistoryPlugin({}, store)

    await plugin.handle(_dart_hit_event("T20", 60))

    games = store.recent_games()
    assert games == []


@pytest.mark.asyncio
async def test_game_finished_only_ended_once(tmp_path: Path) -> None:
    """end_game is only called once even if multiple finished state events arrive."""
    store = _make_store(tmp_path)
    plugin = HistoryPlugin({}, store)

    players = [_player("p1", "Alice")]
    await plugin.handle(GameStarted(mode="x01", players=players, options={}))

    finished_event = _game_state_event(players, active_index=0, status=GameStatus.FINISHED, winner="p1")
    await plugin.handle(finished_event)
    await plugin.handle(finished_event)  # second call should be a no-op

    games = store.recent_games()
    assert len(games) == 1
    # The game was ended only once; ended_at should be set
    assert games[0]["winner"] == "Alice"


@pytest.mark.asyncio
async def test_player_stats_after_game(tmp_path: Path) -> None:
    """Full sequence: start, throws, finish -> player_stats reflects reality."""
    store = _make_store(tmp_path)
    plugin = HistoryPlugin({}, store)

    players = [_player("p1", "Alice"), _player("p2", "Bob")]
    await plugin.handle(GameStarted(mode="x01", players=players, options={}))

    # Alice active
    await plugin.handle(_game_state_event(players, active_index=0, status=GameStatus.IN_PROGRESS))
    await plugin.handle(_dart_hit_event("T20", 60))
    await plugin.handle(_dart_hit_event("S1", 1))

    # Bob active
    await plugin.handle(_game_state_event(players, active_index=1, status=GameStatus.IN_PROGRESS))
    await plugin.handle(_dart_hit_event("S5", 5))

    # Game over: Alice wins
    await plugin.handle(_game_state_event(players, active_index=0, status=GameStatus.FINISHED, winner="p1"))

    stats = store.player_stats()
    alice = next(s for s in stats if s["player"] == "Alice")
    bob = next(s for s in stats if s["player"] == "Bob")

    assert alice["darts"] == 2
    assert alice["total_scored"] == 61
    assert alice["wins"] == 1

    assert bob["darts"] == 1
    assert bob["total_scored"] == 5
    assert bob["wins"] == 0
