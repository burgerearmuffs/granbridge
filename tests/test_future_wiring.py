from typer.testing import CliRunner
from granbridge.cli import app
from granbridge.config import Settings
from granbridge.integrations.registry import build_enabled
from granbridge.net.relay_plugin import RelayPlugin
from granbridge.commentary.plugin import CommentaryPlugin


def test_relay_command_in_help():
    r = CliRunner().invoke(app, ["--help"])
    assert r.exit_code == 0 and "relay" in r.output


def test_registry_has_future_plugins():
    plugins = build_enabled(Settings(plugins_enabled=["relay", "commentary"]))
    assert any(isinstance(p, RelayPlugin) for p in plugins)
    assert any(isinstance(p, CommentaryPlugin) for p in plugins)
