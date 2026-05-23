# Hardening Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a WebSocket Origin guard for non-loopback binds (CSWSH protection) and move writable paths (`overrides_path`, `log_dir`) to `%LOCALAPPDATA%\granbridge` so the packaged app behaves.

**Architecture:** A pure `_origin_policy(host, http_port, extra)` helper drives the `websockets` `origins=` param in `WebSocketServer.start()` — `None` (allow all) for loopback, an allowlist for non-loopback. Two `config.py` path defaults repoint to the existing AppData base. Python-only; small.

**Tech Stack:** Python 3.14, pydantic-settings, websockets 16.0, pytest.

**Branch:** `hardening-followups` (already cut from `main`).

**Baseline (green at plan time):** 188 Python tests. (UI untouched.)

---

## Task 1: Config — allowed_origins + AppData paths

**Files:**
- Modify: `src/granbridge/config.py`
- Test: `tests/test_config.py`

- [ ] **Step 1: Write the failing tests** — append to `tests/test_config.py`:

```python
def test_writable_paths_in_appdata():
    s = Settings()
    assert "granbridge" in s.overrides_path.parts
    assert s.overrides_path.name == "segment_map.overrides.json"
    assert "granbridge" in s.log_dir.parts
    assert s.log_dir.name == "logs"

def test_allowed_origins_default_empty():
    assert Settings().allowed_origins == []
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_config.py -q`
Expected: FAIL — `overrides_path` is the repo-relative path (no `granbridge` part); `allowed_origins` undefined.

- [ ] **Step 3: Edit `src/granbridge/config.py`**

(a) Add the setting after `ws_port`:
```python
    ws_port: int = 8787
    allowed_origins: list[str] = []
```
(b) Repoint `log_dir` and `overrides_path` to the AppData base (matching `history_db`):
```python
    log_dir: Path = Path(os.environ.get("LOCALAPPDATA", ".")) / "granbridge" / "logs"
    overrides_path: Path = Path(os.environ.get("LOCALAPPDATA", ".")) / "granbridge" / "segment_map.overrides.json"
```
(Leave `history_db` and the other fields unchanged.)

- [ ] **Step 4: Run to verify pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_config.py -q`
Expected: PASS (existing 2 + new 2). If any OTHER test asserts the old `log_dir == Path("logs")` or the old `overrides_path`, update it to the AppData expectation (grep `Path("logs")` / `overrides_path` in tests).

- [ ] **Step 5: Commit**

```bash
git add src/granbridge/config.py tests/test_config.py
git commit -m "harden(config): allowed_origins setting + overrides_path/log_dir to AppData

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: WS server Origin guard + wiring

**Files:**
- Modify: `src/granbridge/api/ws_server.py`
- Modify: `src/granbridge/cli.py`
- Test: `tests/api/test_ws_server.py`

- [ ] **Step 1: Write the failing tests** — append to `tests/api/test_ws_server.py`:

```python
from granbridge.api.ws_server import _origin_policy

def test_origin_policy_loopback_allows_all():
    assert _origin_policy("127.0.0.1", 8080, []) is None
    assert _origin_policy("localhost", 8080, []) is None
    assert _origin_policy("::1", 8080, []) is None

def test_origin_policy_non_loopback_enforces_allowlist():
    origins = _origin_policy("0.0.0.0", 8080, [])
    assert origins is not None
    assert "http://0.0.0.0:8080" in origins
    assert "http://localhost:8080" in origins
    assert "http://127.0.0.1:8080" in origins
    assert None in origins                       # non-browser clients (missing Origin) allowed

def test_origin_policy_includes_extras():
    origins = _origin_policy("tower.example", 8080, ["https://my.app"])
    assert "https://my.app" in origins
    assert None in origins
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/Scripts/python.exe -m pytest tests/api/test_ws_server.py -q`
Expected: FAIL — cannot import `_origin_policy`.

- [ ] **Step 3: Edit `src/granbridge/api/ws_server.py`**

(a) Add the loopback set + helper at module level (after the `log = structlog.get_logger(__name__)` line):
```python
_LOOPBACK = {"127.0.0.1", "localhost", "::1", ""}


def _origin_policy(host: str, http_port: int, extra: list[str]) -> Optional[list[Optional[str]]]:
    """Allowlist for websockets `serve(origins=...)`.

    Loopback binds are local-only and safe → return None (allow all). Non-loopback binds
    enforce a CSWSH guard: the served UI origins + any extras, plus None (a missing Origin =
    a non-browser client; browsers always send Origin, so the guard still holds)."""
    if host in _LOOPBACK:
        return None
    return [
        f"http://{host}:{http_port}",
        f"http://localhost:{http_port}",
        f"http://127.0.0.1:{http_port}",
        *extra,
        None,
    ]
```

(b) Extend `__init__` to accept `http_port` + `allowed_origins` (both with safe defaults so `replay` and existing tests are unaffected):
```python
    def __init__(self, bus: EventBus, host: str, port: int,
                 command_handler: Optional[Callable[[dict], None]] = None,
                 http_port: int = 8080, allowed_origins: Optional[list[str]] = None) -> None:
        self._bus = bus
        self._host = host
        self._port = port
        self._command_handler = command_handler
        self._http_port = http_port
        self._allowed_origins = allowed_origins or []
        self._server: Optional[Server] = None
```

(c) Update `start()` to pass the origins policy:
```python
    async def start(self) -> None:
        origins = _origin_policy(self._host, self._http_port, self._allowed_origins)
        self._server = await serve(self._handle, self._host, self._port, origins=origins)
        log.info("ws_server.started", host=self._host, port=self._port, origins_guarded=origins is not None)
```

- [ ] **Step 4: Pass the settings through in `src/granbridge/cli.py`**

In the `serve` command, find:
```python
        server = WebSocketServer(bus, settings.ws_host, settings.ws_port, command_handler=command_handler)
```
and change it to:
```python
        server = WebSocketServer(bus, settings.ws_host, settings.ws_port, command_handler=command_handler,
                                 http_port=settings.http_port, allowed_origins=settings.allowed_origins)
```
(Leave the `replay` command's `WebSocketServer(bus, settings.ws_host, settings.ws_port)` UNCHANGED — it relies on the new defaults.)

- [ ] **Step 5: Run the new tests + full Python suite**

Run: `.venv/Scripts/python.exe -m pytest tests/api/test_ws_server.py -q`
Expected: PASS — the 3 new origin-policy tests AND the existing loopback integration test (loopback → `origins=None` → connect succeeds).
Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: PASS — 193 (188 + 5 new). All existing api/cli tests green.

- [ ] **Step 6: Commit**

```bash
git add src/granbridge/api/ws_server.py src/granbridge/cli.py tests/api/test_ws_server.py
git commit -m "harden(ws): Origin guard for non-loopback binds (CSWSH protection)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Final verification
- [ ] `.venv/Scripts/python.exe -m pytest -q` → 193 passed.
- [ ] Then: review, merge to `main`. (Compile + release happen after the icon work.)

---

## Self-Review (against the spec)
- **Origin guard:** `_origin_policy` helper (loopback→None, non-loopback→allowlist incl. served origins + extras + None) → Task 2 + tests. Wired via `serve(origins=...)` in `start()`; `__init__` gains `http_port`/`allowed_origins` with defaults (replay/tests safe); cli passes settings. ✓
- **AppData paths:** `overrides_path` + `log_dir` → `%LOCALAPPDATA%\granbridge` → Task 1 + tests. `allowed_origins` setting added. ✓
- **Placeholder scan:** none — full code + tests + commands in every step.
- **Type consistency:** `_origin_policy(host: str, http_port: int, extra: list[str]) -> Optional[list[Optional[str]]]` is used identically by `start()` and the tests; `allowed_origins: list[str]` matches between config, the `WebSocketServer` param, and the cli pass-through. `serve(origins=...)` accepts `None` or a list (websockets 16.0). No mismatches.
