import asyncio, pytest
from granbridge.core.bus import EventBus
from granbridge.game.engine import GameEngine
from granbridge.game.commands import StartGame
from granbridge.game.models import Dart

async def test_x01_micro_leg_to_game_won():
    bus = EventBus()
    eng = GameEngine(bus)
    seen = []
    async def collect():
        with bus.subscribe() as sub:
            while True:
                seen.append(await sub.get())
    task = asyncio.create_task(collect())
    await asyncio.sleep(0)
    eng.handle_command(StartGame(command="start_game", mode="x01", players=["A"],
                                 options={"start_score": 60, "double_out": True, "best_of_legs": 1}))
    await eng._flush()
    eng.on_dart(Dart.from_bed("S20")); await eng._flush()   # 60 -> 40
    eng.on_dart(Dart.from_bed("D20")); await eng._flush()   # 40 -> 0 on a double -> win
    await asyncio.sleep(0.05)
    task.cancel()
    assert any(e.type == "game_won" for e in seen)
