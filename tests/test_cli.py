from typer.testing import CliRunner
from granbridge.cli import app

runner = CliRunner()

def test_help_lists_all_commands():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for cmd in ("scan", "serve", "calibrate", "replay"):
        assert cmd in result.output

def test_serve_help_shows_open_flag():
    result = runner.invoke(app, ["serve", "--help"])
    assert result.exit_code == 0
    assert "--open" in result.output
