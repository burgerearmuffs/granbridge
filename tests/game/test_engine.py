from granbridge.core.bus import EventBus
from granbridge.game.engine import GameEngine
from granbridge.game.commands import StartGame, NextPlayer, Undo, RecordMiss, CorrectLast
from granbridge.game.models import Dart

def _engine():
    return GameEngine(EventBus())

def _start(eng, **opts):
    eng.handle_command(StartGame(command="start_game", mode=opts.pop("mode", "x01"),
                                 players=opts.pop("players", ["A"]), options=opts))

def test_start_game_in_progress():
    eng = _engine(); _start(eng, start_score=501)
    assert eng.state.status.value == "in_progress"
    assert eng.state.mode_view["scores"]["p1"] == 501

def test_dart_scores_active_player():
    eng = _engine(); _start(eng, start_score=501)
    eng.on_dart(Dart.from_bed("T20"))
    assert eng.state.mode_view["scores"]["p1"] == 441

def test_auto_advance_after_three_darts():
    eng = _engine(); _start(eng, players=["A", "B"], start_score=501)
    for _ in range(3):
        eng.on_dart(Dart.from_bed("S1"))
    assert eng.state.active_index == 1 and eng.state.visit == []

def test_record_miss_counts_as_dart():
    eng = _engine(); _start(eng, players=["A", "B"], start_score=501)
    eng.handle_command(RecordMiss(command="record_miss"))
    assert len(eng.state.visit) == 1

def test_next_player_advances_early():
    eng = _engine(); _start(eng, players=["A", "B"], start_score=501)
    eng.on_dart(Dart.from_bed("S5"))
    eng.handle_command(NextPlayer(command="next_player"))
    assert eng.state.active_index == 1 and eng.state.visit == []

def test_undo_restores_previous():
    eng = _engine(); _start(eng, start_score=501)
    eng.on_dart(Dart.from_bed("T20"))
    eng.handle_command(Undo(command="undo"))
    assert eng.state.mode_view["scores"]["p1"] == 501 and eng.state.visit == []

def test_correct_last_replaces_dart():
    eng = _engine(); _start(eng, start_score=501)
    eng.on_dart(Dart.from_bed("S20"))   # misread
    eng.handle_command(CorrectLast(command="correct_last", bed="T20"))
    assert eng.state.mode_view["scores"]["p1"] == 441

def test_bust_reverts_visit_and_advances():
    eng = _engine(); _start(eng, players=["A", "B"], start_score=50, double_out=True)
    eng.on_dart(Dart.from_bed("S10"))   # 40
    eng.on_dart(Dart.from_bed("T20"))   # -20 -> bust
    assert eng.state.mode_view["scores"]["p1"] == 50 and eng.state.active_index == 1

def test_dart_without_game_queues_command_error():
    eng = _engine()
    eng.on_dart(Dart.from_bed("T20"))
    assert any(getattr(e, "category", None) == "command" for e in eng._pending)

def test_game_won_emitted_on_finish():
    eng = _engine(); _start(eng, start_score=40, double_out=True, best_of_legs=1)
    eng.on_dart(Dart.from_bed("D20"))
    assert eng.state.status.value == "finished" and eng.state.winner == "p1"
    assert any(e.type == "game_won" for e in eng._pending)

def test_public_flush_publishes_pending_events():
    import asyncio

    async def _run():
        bus = EventBus()
        eng = GameEngine(bus)
        with bus.subscribe() as sub:
            _start(eng, start_score=501)
            assert eng._pending  # queued, not yet published
            await eng.flush()
            assert eng._pending == []
            ev = await asyncio.wait_for(sub.get(), timeout=1)
            assert ev is not None

    asyncio.run(_run())
