from granbridge.core.bus import EventBus
from granbridge.game.engine import GameEngine
from granbridge.game.commands import StartGame, RemoteDart, SetRemoteRole
from granbridge.game.models import Dart


def _engine():
    return GameEngine(EventBus())


def _start_remote(eng, **opts):
    """Start a 2-player x01 match in remote mode with the host's local slot = p1."""
    eng.handle_command(SetRemoteRole(command="set_remote_role", player="p1"))
    eng.handle_command(StartGame(command="start_game", mode="x01",
                                 players=opts.pop("players", ["Host", "Guest"]),
                                 options=opts or {"start_score": 501}))


def test_local_dart_scores_for_active_host():
    eng = _engine(); _start_remote(eng, start_score=501)
    eng.on_dart(Dart.from_bed("T20"), source_player_id="p1")  # p1 is active
    assert eng.state.mode_view["scores"]["p1"] == 441


def test_out_of_turn_local_dart_ignored():
    eng = _engine(); _start_remote(eng, start_score=501)
    for _ in range(3):                                       # advance to p2
        eng.on_dart(Dart.from_bed("S1"), source_player_id="p1")
    assert eng.state.active_index == 1
    before = eng.state.mode_view["scores"]["p1"]
    eng.on_dart(Dart.from_bed("T20"), source_player_id="p1")  # host throws on p2's turn
    assert eng.state.mode_view["scores"]["p1"] == before      # ignored
    assert eng.state.active_index == 1


def test_remote_dart_scores_for_active_guest():
    eng = _engine(); _start_remote(eng, start_score=501)
    for _ in range(3):
        eng.on_dart(Dart.from_bed("S1"), source_player_id="p1")
    assert eng.state.active_index == 1
    eng.handle_command(RemoteDart(command="remote_dart", bed="T20", player="p2"))
    assert eng.state.mode_view["scores"]["p2"] == 441


def test_remote_dart_out_of_turn_ignored():
    eng = _engine(); _start_remote(eng, start_score=501)
    eng.handle_command(RemoteDart(command="remote_dart", bed="T20", player="p2"))  # p1 active
    assert eng.state.mode_view["scores"]["p2"] == 501


def test_full_alternating_sequence():
    eng = _engine(); _start_remote(eng, start_score=501)
    for _ in range(3):
        eng.on_dart(Dart.from_bed("T20"), source_player_id="p1")  # p1: 180
    assert eng.state.active_index == 1
    assert eng.state.mode_view["scores"]["p1"] == 501 - 180
    for _ in range(3):
        eng.handle_command(RemoteDart(command="remote_dart", bed="T19", player="p2"))  # p2: 171
    assert eng.state.active_index == 0
    assert eng.state.mode_view["scores"]["p2"] == 501 - 171


def test_gate_disabled_in_local_play():
    """Regression: with no remote role set (one shared board), darts always apply
    to the active player even as it alternates p1->p2."""
    eng = _engine()
    eng.handle_command(StartGame(command="start_game", mode="x01",
                                 players=["A", "B"], options={"start_score": 501}))
    for _ in range(3):
        eng.on_dart(Dart.from_bed("S20"))  # p1 (source defaults to None)
    assert eng.state.active_index == 1
    for _ in range(3):
        eng.on_dart(Dart.from_bed("S20"))  # p2 — must still score
    assert eng.state.mode_view["scores"]["p1"] == 501 - 60
    assert eng.state.mode_view["scores"]["p2"] == 501 - 60


def test_set_remote_role_none_disables_gate():
    eng = _engine(); _start_remote(eng, start_score=501)
    eng.handle_command(SetRemoteRole(command="set_remote_role", player=None))
    for _ in range(3):
        eng.on_dart(Dart.from_bed("S20"), source_player_id="p1")
    assert eng.state.active_index == 1
    # role cleared -> a p1-tagged dart on p2's turn now applies (local semantics)
    eng.on_dart(Dart.from_bed("S20"), source_player_id="p1")
    assert eng.state.mode_view["scores"]["p2"] == 501 - 20
