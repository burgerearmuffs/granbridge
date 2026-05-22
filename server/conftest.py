"""conftest.py — add server/ to sys.path so granbridge_broker is importable
when running: pytest server/tests   (from the repo root)
"""
import sys
import os

# Insert the directory that contains granbridge_broker/ onto sys.path
_SERVER_DIR = os.path.dirname(__file__)
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)
