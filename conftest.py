"""Repo-root pytest config.

On this Windows environment the system temp dir has a pre-existing
C:\\Users\\...\\Temp\\pytest-of-<user> directory with broken ACLs that raise
PermissionError (WinError 5) when pytest's tmp_path_factory writes into it.
Override tmp_path to use a repo-local scratch area so tests work without admin
access. (Mirrors server/conftest.py, which applies the same fix to the broker
test suite; asyncio_mode=auto is inherited from pyproject.toml.)
"""
import pathlib
import tempfile
import pytest

_SCRATCH = pathlib.Path(__file__).parent / ".pytest_tmp"


@pytest.fixture
def tmp_path(request, tmp_path_factory):
    """Repo-local tmp_path override — avoids system-temp permission issues on Windows."""
    _SCRATCH.mkdir(parents=True, exist_ok=True)
    d = pathlib.Path(tempfile.mkdtemp(dir=_SCRATCH, prefix=request.node.name[:32] + "_"))
    yield d
    import shutil
    shutil.rmtree(d, ignore_errors=True)
