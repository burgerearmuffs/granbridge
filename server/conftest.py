"""conftest.py — add server/ to sys.path so granbridge_broker is importable
when running: pytest server/tests   (from the repo root)
"""
import sys
import os
import pathlib
import tempfile
import pytest

# Insert the directory that contains granbridge_broker/ onto sys.path
_SERVER_DIR = os.path.dirname(__file__)
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

# On Windows this environment's system temp dir has a pre-existing
# C:\Users\...\Temp\pytest-of-<user> directory with broken ACLs that raise
# PermissionError (WinError 5) when pytest's tmp_path_factory writes into it.
# Override tmp_path to use a repo-local scratch area so tests work without admin
# access. (asyncio_mode=auto is inherited from the root pyproject.toml — no
# server/pytest.ini needed.)
_SCRATCH = pathlib.Path(_SERVER_DIR) / ".pytest_tmp"


@pytest.fixture
def tmp_path(request, tmp_path_factory):
    """Repo-local tmp_path override — avoids system-temp permission issues on Windows."""
    _SCRATCH.mkdir(parents=True, exist_ok=True)
    d = pathlib.Path(tempfile.mkdtemp(dir=_SCRATCH, prefix=request.node.name[:32] + "_"))
    yield d
    import shutil
    shutil.rmtree(d, ignore_errors=True)
