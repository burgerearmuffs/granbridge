# GRANBRIDGE Future Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Subagents do NOT commit. Tasks A, B, C are PARALLEL-SAFE (disjoint packages `net/`, `commentary/`, `vision/`). Task D (integration: schema_export + registry + cli + docs) is serial, after A–C. None of A/B/C may edit `schema_export.py`, `registry.py`, or `cli.py` — Task D does that.

**Goal:** Local, testable foundations for the three deferred areas — multiplayer (relay), AI commentary (template + LLM seam), camera validation (interface + architecture doc).

**Tech:** Python 3.12+, asyncio, websockets, pydantic, pytest. All testable parts are CI-safe.

---

## Task A: Multiplayer relay (`src/granbridge/net/`)

**Files:** `net/__init__.py`, `net/relay_server.py`, `net/relay_plugin.py`; `tests/net/__init__.py`, `tests/net/test_relay_server.py`, `tests/net/test_relay_plugin.py`.

- [ ] **A1: `relay_server.py`**
```python
from __future__ import annotations

from typing import Optional
from urllib.parse import parse_qs, urlparse

import structlog
from websockets.asyncio.server import Server, ServerConnection, serve

log = structlog.get_logger(__name__)


class RelayServer:
    """Room-based rebroadcast relay. Clients connect with ?room=<id>; a message
    from one client is forwarded to all OTHER clients in the same room. No auth/persistence."""

    def __init__(self, host: str = "127.0.0.1", port: int = 8788) -> None:
        self._host = host
        self._port = port
        self._rooms: dict[str, set[ServerConnection]] = {}
        self._server: Optional[Server] = None

    async def start(self) -> None:
        self._server = await serve(self._handle, self._host, self._port)
        log.info("relay.started", host=self._host, port=self._port)

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    def _room_of(self, ws: ServerConnection) -> str:
        q = parse_qs(urlparse(ws.request.path).query)
        return (q.get("room", ["default"]) or ["default"])[0]

    async def _handle(self, ws: ServerConnection) -> None:
        room = self._room_of(ws)
        self._rooms.setdefault(room, set()).add(ws)
        try:
            async for message in ws:
                for peer in list(self._rooms.get(room, set())):
                    if peer is not ws:
                        await peer.send(message)
        finally:
            self._rooms.get(room, set()).discard(ws)
```

- [ ] **A2: test `tests/net/test_relay_server.py`**
```python
import asyncio, pytest, websockets
from granbridge.net.relay_server import RelayServer

async def test_relay_broadcasts_within_room_only():
    server = RelayServer("127.0.0.1", 8790)
    await server.start()
    try:
        async with websockets.connect("ws://127.0.0.1:8790?room=r1") as a, \
                   websockets.connect("ws://127.0.0.1:8790?room=r1") as b, \
                   websockets.connect("ws://127.0.0.1:8790?room=r2") as c:
            await asyncio.sleep(0.1)
            await a.send("hello")
            assert await asyncio.wait_for(b.recv(), timeout=1) == "hello"
            with pytest.raises(asyncio.TimeoutError):       # different room: nothing
                await asyncio.wait_for(c.recv(), timeout=0.3)
            with pytest.raises(asyncio.TimeoutError):       # sender not echoed
                await asyncio.wait_for(a.recv(), timeout=0.3)
    finally:
        await server.stop()
```

- [ ] **A3: `relay_plugin.py`**
```python
from __future__ import annotations

from typing import Awaitable, Callable, Optional

from granbridge.events.models import BaseEvent
from granbridge.integrations.base import Plugin

Sender = Callable[[str], Awaitable[object]]


class RelayPlugin(Plugin):
    """Forwards local bus events to a relay room (for remote spectating/sync)."""

    name = "relay"

    def __init__(self, config: dict, sender: Optional[Sender] = None) -> None:
        super().__init__(config)
        self._url = config.get("url", "")
        self._room = config.get("room", "default")
        self._sender = sender
        self._ws = None

    async def start(self) -> None:
        if self._sender is None and self._url:
            import websockets  # lazy
            self._ws = await websockets.connect(f"{self._url}?room={self._room}")
            self._sender = self._ws.send

    async def stop(self) -> None:
        if self._ws is not None:
            await self._ws.close()
            self._ws = None

    async def handle(self, event: BaseEvent) -> None:
        if not self._url or self._sender is None:
            return
        await self._sender(event.model_dump_json())
```

- [ ] **A4: test `tests/net/test_relay_plugin.py`**
```python
from granbridge.net.relay_plugin import RelayPlugin
from granbridge.events.models import ConnectionState

async def test_forwards_event_to_injected_sender():
    sent = []
    async def sender(text): sent.append(text)
    p = RelayPlugin({"url": "ws://x", "room": "r1"}, sender=sender)
    await p.handle(ConnectionState(state="connected"))
    assert sent and '"type":"connection_state"' in sent[0].replace(" ", "")

async def test_no_url_is_noop():
    sent = []
    async def sender(text): sent.append(text)
    p = RelayPlugin({}, sender=sender)
    await p.handle(ConnectionState(state="connected"))
    assert sent == []
```

- [ ] **A5:** Run `.venv\Scripts\python -m pytest tests/net -v` → pass.

---

## Task B: AI commentary (`src/granbridge/commentary/`)

**Files:** `commentary/__init__.py`, `commentary/events.py`, `commentary/commentator.py`, `commentary/plugin.py`; `tests/commentary/__init__.py`, `tests/commentary/test_commentator.py`, `tests/commentary/test_plugin.py`. (Do NOT edit schema_export here — Task D does.)

- [ ] **B1: `commentary/events.py`**
```python
from __future__ import annotations
from typing import Literal
from granbridge.events.models import BaseEvent

class Commentary(BaseEvent):
    type: Literal["commentary"] = "commentary"
    text: str
    tone: str = "play-by-play"
```

- [ ] **B2: `commentary/commentator.py`**
```python
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Callable, Optional
from granbridge.events.models import BaseEvent

class Commentator(ABC):
    @abstractmethod
    def comment(self, event: BaseEvent) -> Optional[str]:
        ...

_BED_LINES = {"T20": "Treble twenty!", "T19": "Treble nineteen!",
              "BULL": "Bullseye!", "DBULL": "Double bull!", "MISS": "Off the board!"}

class TemplateCommentator(Commentator):
    """Offline, rule-based commentary."""
    def comment(self, event: BaseEvent) -> Optional[str]:
        t = event.type
        if t == "dart_hit":
            return _BED_LINES.get(getattr(event, "bed", ""), None)
        if t == "bust":
            return "No score — bust!"
        if t == "leg_won":
            return f"{getattr(event, 'player', 'Player')} takes the leg!"
        if t == "game_won":
            return f"Game shot! {getattr(event, 'player', 'Player')} wins!"
        return None

class LLMCommentator(Commentator):
    """Seam for LLM-generated commentary. FLAGGED: needs an injected `generate` callable
    backed by an LLM provider + API key; not wired to any provider here."""
    def __init__(self, generate: Optional[Callable[[BaseEvent], Optional[str]]] = None) -> None:
        self._generate = generate
    def comment(self, event: BaseEvent) -> Optional[str]:
        if self._generate is None:
            raise RuntimeError("LLMCommentator needs a `generate` callable (LLM client/API key)")
        return self._generate(event)
```

- [ ] **B3: test `tests/commentary/test_commentator.py`**
```python
import pytest
from granbridge.commentary.commentator import TemplateCommentator, LLMCommentator
from granbridge.events.models import DartHit, ErrorEvent, Ring
from granbridge.game.events import Bust, GameWon

def _hit(bed, score): return DartHit(raw=f"{bed}@", ring=Ring.TRIPLE, segment=20, multiplier=3, bed=bed, score=score)

def test_template_lines():
    c = TemplateCommentator()
    assert c.comment(_hit("T20", 60)) == "Treble twenty!"
    assert c.comment(Bust(player="A", score_attempted=10, reason="bust")) == "No score — bust!"
    assert "wins" in c.comment(GameWon(player="Ann"))
    assert c.comment(_hit("S3", 3)) is None  # uninteresting

def test_llm_requires_generate():
    with pytest.raises(RuntimeError):
        LLMCommentator().comment(_hit("T20", 60))
    assert LLMCommentator(generate=lambda e: "custom").comment(_hit("T20", 60)) == "custom"
```

- [ ] **B4: `commentary/plugin.py`**
```python
from __future__ import annotations
from typing import Awaitable, Callable, Optional
from granbridge.events.models import BaseEvent
from granbridge.integrations.base import Plugin
from granbridge.commentary.commentator import Commentator, TemplateCommentator
from granbridge.commentary.events import Commentary

Publish = Callable[[BaseEvent], Awaitable[None]]

class CommentaryPlugin(Plugin):
    """Generates commentary lines and publishes them as `commentary` events.
    The one plugin allowed to publish (via injected `publish`); never comments on its own output.
    Also detects a 180 across a 3-dart visit."""
    name = "commentary"
    def __init__(self, config: dict, commentator: Optional[Commentator] = None,
                 publish: Optional[Publish] = None) -> None:
        super().__init__(config)
        self._commentator = commentator or TemplateCommentator()
        self._publish = publish
        self._visit: list[int] = []

    def set_publish(self, publish: Publish) -> None:
        self._publish = publish

    async def handle(self, event: BaseEvent) -> None:
        if event.type == "commentary" or self._publish is None:
            return
        line: Optional[str] = None
        if event.type == "dart_hit":
            self._visit.append(getattr(event, "score", 0))
            if len(self._visit) >= 3:
                if sum(self._visit[-3:]) == 180:
                    line = "One hundred and eighty!"
                self._visit = []
        if line is None:
            line = self._commentator.comment(event)
        if line:
            await self._publish(Commentary(text=line))
```

- [ ] **B5: test `tests/commentary/test_plugin.py`**
```python
from granbridge.commentary.plugin import CommentaryPlugin
from granbridge.commentary.events import Commentary
from granbridge.events.models import DartHit, Ring
from granbridge.game.events import GameWon

def _hit(bed, score): return DartHit(raw=f"{bed}@", ring=Ring.TRIPLE, segment=20, multiplier=3, bed=bed, score=score)

async def test_publishes_commentary_for_game_won():
    out = []
    async def publish(ev): out.append(ev)
    p = CommentaryPlugin({}, publish=publish)
    await p.handle(GameWon(player="Ann"))
    assert out and isinstance(out[0], Commentary) and "wins" in out[0].text

async def test_detects_180():
    out = []
    async def publish(ev): out.append(ev)
    p = CommentaryPlugin({}, publish=publish)
    for _ in range(3):
        await p.handle(_hit("T20", 60))
    assert any("180" in e.text or "eighty" in e.text.lower() for e in out)

async def test_ignores_commentary_events():
    out = []
    async def publish(ev): out.append(ev)
    p = CommentaryPlugin({}, publish=publish)
    await p.handle(Commentary(text="x"))
    assert out == []
```

- [ ] **B6:** Run `.venv\Scripts\python -m pytest tests/commentary -v` → pass.

---

## Task C: Camera validation seam + doc (`src/granbridge/vision/`)

**Files:** `vision/__init__.py`, `vision/validator.py`; `tests/vision/__init__.py`, `tests/vision/test_validator.py`; `docs/camera-validation-architecture.md`.

- [ ] **C1: `vision/validator.py`**
```python
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel
from granbridge.events.models import DartHit

class ValidationResult(BaseModel):
    agreed: bool
    detected_bed: Optional[str] = None
    confidence: float = 1.0

class Validator(ABC):
    """Seam for cross-checking a BLE dart_hit against an independent (camera) detection."""
    @abstractmethod
    def validate(self, dart_hit: DartHit) -> ValidationResult:
        ...

class NoOpValidator(Validator):
    """Default: trusts the board. The seam a future CV validator implements."""
    def validate(self, dart_hit: DartHit) -> ValidationResult:
        return ValidationResult(agreed=True, detected_bed=dart_hit.bed, confidence=1.0)
```

- [ ] **C2: test `tests/vision/test_validator.py`**
```python
from granbridge.vision.validator import NoOpValidator, ValidationResult
from granbridge.events.models import DartHit, Ring

def test_noop_agrees():
    r = NoOpValidator().validate(DartHit(raw="T20@", ring=Ring.TRIPLE, segment=20, multiplier=3, bed="T20", score=60))
    assert isinstance(r, ValidationResult) and r.agreed is True and r.detected_bed == "T20"
```

- [ ] **C3: `docs/camera-validation-architecture.md`** — write the design: (a) why deferred (needs
  2–3 cameras + calibration + opencv/numpy; competes with the board's own sensors; user chose
  player-cams over CV autoscoring); (b) rig + calibration overview; (c) detection pipeline
  (frame capture → background subtraction → dart-tip localization → multi-view triangulation →
  board-segment mapping); (d) integration: a `Validator` impl cross-checks each `dart_hit`; on
  disagreement the engine could emit a `validation` event for review/anti-cheat; (e) the
  `NoOpValidator` is the current seam. No code beyond the seam.

- [ ] **C4:** Run `.venv\Scripts\python -m pytest tests/vision -v` → pass.

---

## Task D: Integration (serial, after A–C)

**Files:** modify `src/granbridge/events/schema_export.py`, `src/granbridge/integrations/registry.py`, `src/granbridge/cli.py`, `README.md`; `tests/test_future_wiring.py`.

- [ ] **D1: schema_export** — import `Commentary` from `granbridge.commentary.events` and add `"commentary": Commentary` to `_EVENT_TYPES`. Regenerate schemas:
`.venv\Scripts\python -c "from pathlib import Path; from granbridge.events.schema_export import export_schemas; export_schemas(Path('src/granbridge/events/schema'))"`

- [ ] **D2: registry** — add to `_REGISTRY`: `"relay": RelayPlugin` (from `granbridge.net.relay_plugin`), `"commentary": CommentaryPlugin` (from `granbridge.commentary.plugin`). Import them at top.

- [ ] **D3: cli** — add a `relay` Typer command:
```python
@app.command()
def relay(host: str = "127.0.0.1", port: int = 8788) -> None:
    """Run a local multiplayer relay server (room-based rebroadcast)."""
    import asyncio
    from granbridge.net.relay_server import RelayServer
    async def _run():
        server = RelayServer(host, port)
        await server.start()
        typer.echo(f"Relay on ws://{host}:{port} (join with ?room=<id>)")
        await asyncio.Event().wait()
    asyncio.run(_run())
```
And in `serve`'s `_run()`, after building `plugins`, wire CommentaryPlugin's publisher:
```python
        from granbridge.commentary.plugin import CommentaryPlugin
        for _p in plugins:
            if isinstance(_p, CommentaryPlugin):
                _p.set_publish(bus.publish)
```

- [ ] **D4: test `tests/test_future_wiring.py`**
```python
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
```

- [ ] **D5: README** — add a "Future foundations" section: `granbridge relay` for local multiplayer
  (flag: hosting/auth/TLS needed to go public); commentary plugin emits `commentary` events
  (flag: LLM key + TTS for richer commentary); camera CV validation is architecture-only
  (see `docs/camera-validation-architecture.md`).

- [ ] **D6:** Run `.venv\Scripts\python -m pytest -q` (ALL pass) + `python -c "import granbridge.cli"` clean.

---

## Self-Review
- **Spec coverage:** relay server+plugin+CLI (A/D), commentary events+commentator+plugin (B), LLM seam (B), camera Validator seam + architecture doc (C), schema/registry/cli wiring (D). All mapped.
- **Placeholders:** full code for all testable modules; camera doc is prose by design (no CV impl).
- **Type consistency:** `RelayServer.start/stop`, `RelayPlugin(config,sender=)`, `Commentator.comment`, `CommentaryPlugin(config,commentator=,publish=)`+`set_publish`, `Validator.validate`/`ValidationResult` consistent across tasks + registry + tests.
- **Parallelism:** A/B/C disjoint packages, none touch schema_export/registry/cli; D serial.
- **Safety/flags:** relay no-auth localhost (flagged for public); LLM requires injected generate (raises otherwise); CV not implemented (seam only). Network/relay plugins no-op without config.
