# GRANBRIDGE Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Subagents do NOT commit. After Task 1 (base + deps), Tasks 2–6 (manager + 4 plugins) are PARALLEL-SAFE (disjoint files, each depends only on `integrations/base.py`). Tasks 7–9 (registry, CLI, docs) are serial.

**Goal:** A plugin system over the EventBus + working MQTT/Discord/WLED/logging plugins, with per-plugin error isolation.

**Architecture:** `PluginManager` subscribes to the bus once and dispatches every event to each enabled `Plugin.handle()`, catching exceptions per plugin. Network plugins import their lib (`aiomqtt`/`httpx`) lazily and accept an injected client/poster for tests.

**Tech Stack:** Python 3.12+, asyncio, pydantic, structlog, pytest. New optional deps: `aiomqtt`, `httpx`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/granbridge/integrations/__init__.py` | marker |
| `src/granbridge/integrations/base.py` | `Plugin` ABC |
| `src/granbridge/integrations/manager.py` | `PluginManager` (dispatch + isolation + lifecycle) |
| `src/granbridge/integrations/registry.py` | name→class + `build_enabled(settings)` |
| `src/granbridge/integrations/plugins/{logging_plugin,mqtt_plugin,discord_plugin,wled_plugin}.py` | plugins |
| `src/granbridge/config.py` (modify) | `plugins_enabled`, `plugins` |
| `src/granbridge/cli.py` (modify) | run enabled plugins in `serve` |
| `pyproject.toml` (modify) | `integrations` extra |
| `tests/integrations/...` | mirror |

Run tests via `.venv\Scripts\python -m pytest`. Do NOT commit.

---

## Task 1: Plugin base + config + deps

**Files:** Create `src/granbridge/integrations/__init__.py`, `src/granbridge/integrations/base.py`, `src/granbridge/integrations/plugins/__init__.py`, `tests/integrations/__init__.py`, `tests/integrations/test_base.py`. Modify `config.py`, `pyproject.toml`.

- [ ] **Step 1: Failing test** `tests/integrations/test_base.py`
```python
import pytest
from granbridge.integrations.base import Plugin

def test_plugin_is_abstract():
    with pytest.raises(TypeError):
        Plugin({})
```

- [ ] **Step 2: Implement** `src/granbridge/integrations/base.py`
```python
from __future__ import annotations

from abc import ABC, abstractmethod

from granbridge.events.models import BaseEvent


class Plugin(ABC):
    """A bus consumer. Plugins filter by event.type inside handle(); they never publish."""

    name: str = "plugin"

    def __init__(self, config: dict) -> None:
        self.config = config or {}

    async def start(self) -> None:  # optional setup (open connections)
        return None

    async def stop(self) -> None:  # optional teardown
        return None

    @abstractmethod
    async def handle(self, event: BaseEvent) -> None:
        """Handle one bus event. Must not raise to the manager (manager isolates anyway)."""
```

- [ ] **Step 3: Modify `config.py`** — add to `Settings`:
```python
    plugins_enabled: list[str] = []
    plugins: dict[str, dict] = {}
```

- [ ] **Step 4: Modify `pyproject.toml`** — under `[project.optional-dependencies]`, add:
```toml
integrations = ["aiomqtt>=2.0", "httpx>=0.27"]
```
Then install: `.venv\Scripts\python -m pip install -e ".[dev,integrations]"`.

- [ ] **Step 5: Run** `pytest tests/integrations/test_base.py -v` → pass.

---

## Tasks 2–6: Manager + plugins (PARALLEL-SAFE after Task 1)

### Task 2: PluginManager
**Files:** `src/granbridge/integrations/manager.py`, `tests/integrations/test_manager.py`.

- [ ] **Step 1: Failing test**
```python
import pytest
from granbridge.core.bus import EventBus
from granbridge.integrations.base import Plugin
from granbridge.integrations.manager import PluginManager
from granbridge.events.models import ConnectionState

class Recorder(Plugin):
    name = "rec"
    def __init__(self, config=None):
        super().__init__(config or {})
        self.seen = []
        self.started = False
    async def start(self): self.started = True
    async def handle(self, event): self.seen.append(event.type)

class Boom(Plugin):
    name = "boom"
    def __init__(self, config=None):
        super().__init__(config or {})
    async def handle(self, event): raise RuntimeError("boom")

async def test_dispatch_reaches_all_plugins_with_isolation():
    rec, boom, rec2 = Recorder(), Boom(), Recorder()
    mgr = PluginManager(EventBus(), [rec, boom, rec2])
    await mgr.dispatch(ConnectionState(state="connected"))
    # boom raised but did not stop rec/rec2
    assert rec.seen == ["connection_state"] and rec2.seen == ["connection_state"]

async def test_start_all_calls_start():
    rec = Recorder()
    mgr = PluginManager(EventBus(), [rec])
    await mgr.start_all()
    assert rec.started is True
```

- [ ] **Step 2: Implement** `src/granbridge/integrations/manager.py`
```python
from __future__ import annotations

import asyncio

import structlog

from granbridge.core.bus import EventBus
from granbridge.events.models import BaseEvent
from granbridge.integrations.base import Plugin

log = structlog.get_logger(__name__)


class PluginManager:
    """Subscribes to the bus and dispatches each event to every plugin, isolating errors."""

    def __init__(self, bus: EventBus, plugins: list[Plugin]) -> None:
        self._bus = bus
        self._plugins = plugins
        self._stop = asyncio.Event()

    async def start_all(self) -> None:
        for p in self._plugins:
            try:
                await p.start()
            except Exception as exc:  # noqa: BLE001 - a bad plugin must not stop the others
                log.warning("plugin.start_failed", plugin=p.name, error=str(exc))

    async def stop_all(self) -> None:
        for p in self._plugins:
            try:
                await p.stop()
            except Exception as exc:  # noqa: BLE001
                log.warning("plugin.stop_failed", plugin=p.name, error=str(exc))

    async def dispatch(self, event: BaseEvent) -> None:
        for p in self._plugins:
            try:
                await p.handle(event)
            except Exception as exc:  # noqa: BLE001 - isolation
                log.warning("plugin.error", plugin=p.name, type=event.type, error=str(exc))

    def stop(self) -> None:
        self._stop.set()

    async def run(self) -> None:
        if not self._plugins:
            return
        await self.start_all()
        try:
            with self._bus.subscribe() as sub:
                while not self._stop.is_set():
                    get = asyncio.ensure_future(sub.get())
                    stop = asyncio.ensure_future(self._stop.wait())
                    done, _ = await asyncio.wait({get, stop}, return_when=asyncio.FIRST_COMPLETED)
                    for t in (get, stop):
                        if not t.done():
                            t.cancel()
                    if self._stop.is_set():
                        break
                    if get in done:
                        await self.dispatch(get.result())
        finally:
            await self.stop_all()
```

- [ ] **Step 3: Run** `pytest tests/integrations/test_manager.py -v` → pass.

### Task 3: LoggingPlugin
**Files:** `src/granbridge/integrations/plugins/logging_plugin.py`, `tests/integrations/test_logging_plugin.py`.

- [ ] **Step 1: Failing test**
```python
from granbridge.integrations.plugins.logging_plugin import LoggingPlugin
from granbridge.events.models import DartHit, Ring

async def test_logging_plugin_handles_without_error():
    p = LoggingPlugin({})
    await p.start()
    await p.handle(DartHit(raw="T20@", ring=Ring.TRIPLE, segment=20, multiplier=3, bed="T20", score=60))
    await p.stop()  # no exception == pass
```

- [ ] **Step 2: Implement** `src/granbridge/integrations/plugins/logging_plugin.py`
```python
from __future__ import annotations

import structlog

from granbridge.events.models import BaseEvent
from granbridge.integrations.base import Plugin

log = structlog.get_logger("granbridge.plugin.logging")


class LoggingPlugin(Plugin):
    name = "logging"

    async def handle(self, event: BaseEvent) -> None:
        log.info("event", type=event.type)
```

- [ ] **Step 3: Run** → pass.

### Task 4: MqttPlugin
**Files:** `src/granbridge/integrations/plugins/mqtt_plugin.py`, `tests/integrations/test_mqtt_plugin.py`.

- [ ] **Step 1: Failing test**
```python
from granbridge.integrations.plugins.mqtt_plugin import MqttPlugin
from granbridge.events.models import DartHit, Ring, ConnectionState

class FakeClient:
    def __init__(self): self.published = []
    async def publish(self, topic, payload): self.published.append((topic, payload))

async def test_dart_hit_publishes_to_throw_topic():
    fake = FakeClient()
    p = MqttPlugin({"prefix": "granboard"}, client=fake)
    await p.handle(DartHit(raw="T20@", ring=Ring.TRIPLE, segment=20, multiplier=3, bed="T20", score=60))
    assert fake.published and fake.published[0][0] == "granboard/throw"
    assert '"bed":"T20"' in fake.published[0][1].replace(" ", "")

async def test_connection_state_publishes_to_event_topic():
    fake = FakeClient()
    p = MqttPlugin({"prefix": "granboard"}, client=fake)
    await p.handle(ConnectionState(state="connected"))
    assert fake.published[0][0] == "granboard/event"

async def test_no_client_is_noop():
    p = MqttPlugin({})  # not started, no client
    await p.handle(ConnectionState(state="connected"))  # no error
```

- [ ] **Step 2: Implement** `src/granbridge/integrations/plugins/mqtt_plugin.py`
```python
from __future__ import annotations

from typing import Optional

from granbridge.events.models import BaseEvent
from granbridge.integrations.base import Plugin

_TOPIC = {"dart_hit": "throw", "game_state": "game"}


class MqttPlugin(Plugin):
    name = "mqtt"

    def __init__(self, config: dict, client: Optional[object] = None) -> None:
        super().__init__(config)
        self._client = client
        self._owns = client is None
        self._prefix = config.get("prefix", "granboard")
        self._host = config.get("host", "localhost")
        self._port = int(config.get("port", 1883))

    async def start(self) -> None:
        if self._client is None:
            import aiomqtt  # lazy
            self._client = aiomqtt.Client(hostname=self._host, port=self._port)
            await self._client.__aenter__()

    async def stop(self) -> None:
        if self._owns and self._client is not None:
            await self._client.__aexit__(None, None, None)
            self._client = None

    def _topic(self, event_type: str) -> str:
        return f"{self._prefix}/{_TOPIC.get(event_type, 'event')}"

    async def handle(self, event: BaseEvent) -> None:
        if self._client is None:
            return
        await self._client.publish(self._topic(event.type), event.model_dump_json())
```

- [ ] **Step 3: Run** → pass.

### Task 5: DiscordWebhookPlugin
**Files:** `src/granbridge/integrations/plugins/discord_plugin.py`, `tests/integrations/test_discord_plugin.py`.

- [ ] **Step 1: Failing test**
```python
from granbridge.integrations.plugins.discord_plugin import DiscordWebhookPlugin
from granbridge.game.events import GameWon, LegWon
from granbridge.events.models import DartHit, Ring

async def test_game_won_posts_to_webhook():
    calls = []
    async def poster(url, payload): calls.append((url, payload))
    p = DiscordWebhookPlugin({"webhook_url": "https://hook"}, poster=poster)
    await p.handle(GameWon(player="Ann"))
    assert calls and calls[0][0] == "https://hook" and "Ann" in calls[0][1]["content"]

async def test_dart_hit_does_nothing():
    calls = []
    async def poster(url, payload): calls.append(1)
    p = DiscordWebhookPlugin({"webhook_url": "https://hook"}, poster=poster)
    await p.handle(DartHit(raw="T20@", ring=Ring.TRIPLE, segment=20, multiplier=3, bed="T20", score=60))
    assert calls == []

async def test_no_url_is_noop():
    calls = []
    async def poster(url, payload): calls.append(1)
    p = DiscordWebhookPlugin({}, poster=poster)
    await p.handle(GameWon(player="Ann"))
    assert calls == []
```

- [ ] **Step 2: Implement** `src/granbridge/integrations/plugins/discord_plugin.py`
```python
from __future__ import annotations

from typing import Awaitable, Callable, Optional

from granbridge.events.models import BaseEvent
from granbridge.integrations.base import Plugin

Poster = Callable[[str, dict], Awaitable[object]]


class DiscordWebhookPlugin(Plugin):
    name = "discord"

    def __init__(self, config: dict, poster: Optional[Poster] = None) -> None:
        super().__init__(config)
        self._url = config.get("webhook_url", "")
        self._poster = poster
        self._http = None

    async def start(self) -> None:
        if self._poster is None and self._url:
            import httpx  # lazy
            self._http = httpx.AsyncClient(timeout=5.0)
            self._poster = lambda url, payload: self._http.post(url, json=payload)

    async def stop(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    async def handle(self, event: BaseEvent) -> None:
        if not self._url or self._poster is None:
            return
        if event.type == "game_won":
            await self._poster(self._url, {"content": f"\U0001F3C6 {event.player} wins the game!"})
        elif event.type == "leg_won":
            await self._poster(self._url, {"content": f"\U0001F3AF {event.player} takes a leg ({event.legs})"})
```

- [ ] **Step 3: Run** → pass.

### Task 6: WledPlugin
**Files:** `src/granbridge/integrations/plugins/wled_plugin.py`, `tests/integrations/test_wled_plugin.py`.

- [ ] **Step 1: Failing test**
```python
from granbridge.integrations.plugins.wled_plugin import WledPlugin
from granbridge.game.events import GameWon, Bust

async def test_game_won_posts_celebration():
    calls = []
    async def poster(url, payload): calls.append((url, payload))
    p = WledPlugin({"host": "1.2.3.4", "win_fx": 80}, poster=poster)
    await p.handle(GameWon(player="Ann"))
    assert calls[0][0] == "http://1.2.3.4/json/state"
    assert calls[0][1]["seg"][0]["fx"] == 80

async def test_bust_posts_red_flash():
    calls = []
    async def poster(url, payload): calls.append((url, payload))
    p = WledPlugin({"host": "1.2.3.4"}, poster=poster)
    await p.handle(Bust(player="p1", score_attempted=10, reason="bust"))
    assert calls and calls[0][1]["on"] is True

async def test_no_host_is_noop():
    calls = []
    async def poster(url, payload): calls.append(1)
    p = WledPlugin({}, poster=poster)
    await p.handle(GameWon(player="Ann"))
    assert calls == []
```

- [ ] **Step 2: Implement** `src/granbridge/integrations/plugins/wled_plugin.py`
```python
from __future__ import annotations

from typing import Awaitable, Callable, Optional

from granbridge.events.models import BaseEvent
from granbridge.integrations.base import Plugin

Poster = Callable[[str, dict], Awaitable[object]]


class WledPlugin(Plugin):
    name = "wled"

    def __init__(self, config: dict, poster: Optional[Poster] = None) -> None:
        super().__init__(config)
        self._host = config.get("host", "")
        self._win_fx = int(config.get("win_fx", 80))
        self._bust_fx = int(config.get("bust_fx", 1))
        self._poster = poster
        self._http = None

    async def start(self) -> None:
        if self._poster is None and self._host:
            import httpx  # lazy
            self._http = httpx.AsyncClient(timeout=5.0)
            self._poster = lambda url, payload: self._http.post(url, json=payload)

    async def stop(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    async def handle(self, event: BaseEvent) -> None:
        if not self._host or self._poster is None:
            return
        url = f"http://{self._host}/json/state"
        if event.type == "game_won":
            await self._poster(url, {"on": True, "seg": [{"fx": self._win_fx}]})
        elif event.type == "bust":
            await self._poster(url, {"on": True, "seg": [{"fx": self._bust_fx, "col": [[255, 0, 0]]}]})
```

- [ ] **Step 3: Run** → pass.

---

## Task 7: Registry

**Files:** `src/granbridge/integrations/registry.py`, `tests/integrations/test_registry.py`.

- [ ] **Step 1: Failing test**
```python
from granbridge.config import Settings
from granbridge.integrations.registry import build_enabled
from granbridge.integrations.plugins.logging_plugin import LoggingPlugin
from granbridge.integrations.plugins.mqtt_plugin import MqttPlugin

def test_build_enabled_instantiates_named_plugins():
    s = Settings(plugins_enabled=["logging", "mqtt"], plugins={"mqtt": {"prefix": "darts"}})
    plugins = build_enabled(s)
    assert [type(p) for p in plugins] == [LoggingPlugin, MqttPlugin]
    assert plugins[1]._prefix == "darts"

def test_unknown_plugin_skipped():
    s = Settings(plugins_enabled=["nope"])
    assert build_enabled(s) == []
```

- [ ] **Step 2: Implement** `src/granbridge/integrations/registry.py`
```python
from __future__ import annotations

from granbridge.config import Settings
from granbridge.integrations.base import Plugin
from granbridge.integrations.plugins.discord_plugin import DiscordWebhookPlugin
from granbridge.integrations.plugins.logging_plugin import LoggingPlugin
from granbridge.integrations.plugins.mqtt_plugin import MqttPlugin
from granbridge.integrations.plugins.wled_plugin import WledPlugin

_REGISTRY: dict[str, type[Plugin]] = {
    "logging": LoggingPlugin,
    "mqtt": MqttPlugin,
    "discord": DiscordWebhookPlugin,
    "wled": WledPlugin,
}


def build_enabled(settings: Settings) -> list[Plugin]:
    out: list[Plugin] = []
    for name in settings.plugins_enabled:
        cls = _REGISTRY.get(name)
        if cls is not None:
            out.append(cls(settings.plugins.get(name, {})))
    return out
```

- [ ] **Step 3: Run** → pass.

---

## Task 8: CLI wiring

**Files:** modify `src/granbridge/cli.py`; `tests/integrations/test_cli_wiring.py`.

- [ ] **Step 1: Test** `tests/integrations/test_cli_wiring.py`
```python
from granbridge.config import Settings
from granbridge.integrations.registry import build_enabled
from granbridge.core.bus import EventBus
from granbridge.integrations.manager import PluginManager

def test_manager_builds_from_settings():
    s = Settings(plugins_enabled=["logging"])
    mgr = PluginManager(EventBus(), build_enabled(s))
    assert mgr is not None
```

- [ ] **Step 2: Modify `cli.py` `serve`** — after building `engine` and before `await asyncio.gather(...)`, add:
```python
        from granbridge.integrations.manager import PluginManager
        from granbridge.integrations.registry import build_enabled
        plugins = build_enabled(settings)
        plugin_mgr = PluginManager(bus, plugins)
```
and change the gather to: `await asyncio.gather(mgr.run(), engine.attach(), plugin_mgr.run())`.

- [ ] **Step 3: Run** `pytest -q` (all pass) + `python -c "import granbridge.cli"` clean.

---

## Task 9: Docs

- [ ] Add an "Integrations / plugins" section to `README.md`: enable plugins via
  `GRANBRIDGE_PLUGINS_ENABLED` / a settings file; per-plugin config (mqtt host/prefix, discord
  webhook_url, wled host); note that MQTT needs a broker and Discord/WLED need an endpoint
  (otherwise they no-op). Mention `pip install -e ".[integrations]"`.

---

## Self-Review
- **Spec coverage:** Plugin interface + manager isolation (T1/T2), config-driven enable + registry (T1/T7), MQTT (T4), Discord (T5), WLED (T6), logging (T3), serve wiring (T8), tests with fakes (each), docs (T9). All criteria mapped.
- **Placeholders:** none; full code for every module.
- **Type consistency:** `Plugin.start/stop/handle`, `PluginManager.dispatch/start_all/stop_all/run`, `build_enabled(settings)`, plugin ctors `(config, client=/poster=)` consistent across registry + tests. Registry keys match `_REGISTRY`.
- **Parallelism:** T2–T6 disjoint files depending only on base → concurrent; T7/T8 serial.
- **Safety:** plugins are consume-only (never publish); manager isolates exceptions; network plugins no-op without an endpoint; libs imported lazily.
