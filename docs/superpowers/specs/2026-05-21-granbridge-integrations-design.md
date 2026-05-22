# GRANBRIDGE — Sub-project 4: "Integrations" (Design Spec)

- **Date:** 2026-05-21 · Self-approved under the autonomous-build mandate.
- **Depends on:** SP1 (EventBus + events) + SP2 (game events).
- **External deps:** `aiomqtt` (MQTT) and `httpx` (HTTP) added as a `[integrations]` extra;
  imported lazily inside plugins so the modules import without them. Running MQTT needs a broker;
  Discord/WLED need a webhook URL / device IP — all **flagged**, tested with fakes.

---

## 1. Goal & Success Criteria

A plugin system that lets external integrations subscribe to GRANBRIDGE events, plus working
example plugins (MQTT, Discord webhook, WLED) and a local logging plugin.

**Done when:**
1. A `Plugin` interface + `PluginManager` subscribe to the bus and dispatch every event to each
   enabled plugin, with **per-plugin error isolation** (one plugin raising never breaks the bus,
   the engine, or other plugins).
2. Plugins are enabled/configured via `Settings` and loaded by name from a registry.
3. **MqttPlugin** publishes events to MQTT topics (e.g. `granboard/throw`, `granboard/game`).
4. **DiscordWebhookPlugin** POSTs a message on `leg_won`/`game_won`.
5. **WledPlugin** POSTs a celebration effect on `bust`/`game_won`.
6. **LoggingPlugin** (no external dep) logs events — proves the API end-to-end offline.
7. `granbridge serve` loads enabled plugins and runs them with the engine + connection manager.
8. Unit tests cover the manager (dispatch + isolation) and each plugin (with fakes); all green, CI-safe.

**Non-goals:** a plugin marketplace, dynamic hot-reload, third-party plugin discovery via entry
points (the registry is a fixed dict for now), Home Assistant/Hue (WLED + MQTT cover the pattern;
others are follow-ups using the same interface).

---

## 2. Design

- **`Plugin` ABC** (`integrations/base.py`): `name`; `__init__(config: dict)`; `async start()`;
  `async stop()`; `async handle(event: BaseEvent)`. Plugins filter by `event.type` inside `handle`.
- **`PluginManager`** (`integrations/manager.py`): given the bus + a list of `Plugin` instances,
  `run()` subscribes once and dispatches each event to every plugin's `handle`, catching and
  logging exceptions per-plugin (isolation). `start()`/`stop()` lifecycle for all plugins.
- **Registry** (`integrations/registry.py`): `{name: PluginClass}` + `build_enabled(settings)` →
  instantiate the plugins named in `settings.plugins_enabled` with their per-plugin config.
- **Lazy deps:** MQTT/HTTP plugins import `aiomqtt`/`httpx` inside `start()`, so the modules import
  (and unit-test with injected fakes) without the libraries present.
- **Config:** `Settings` gains `plugins_enabled: list[str]` and a `plugins: dict[str, dict]`
  (per-plugin config: mqtt host/port/prefix, discord webhook_url, wled host).

---

## 3. Architecture

```
EventBus ──▶ PluginManager.run() ──┬─▶ LoggingPlugin.handle(event)
  (all events)                     ├─▶ MqttPlugin.handle(event)   → broker (aiomqtt)
                                   ├─▶ DiscordWebhookPlugin.handle → webhook (httpx)
                                   └─▶ WledPlugin.handle           → WLED device (httpx)
   each handle() wrapped in try/except → error logged, isolated, never propagates
```
Plugins are bus consumers only (they never publish), so they cannot disrupt gameplay. The manager
runs as one more asyncio task in `serve`.

---

## 4. Component Inventory (`src/granbridge/integrations/`)

| File | Responsibility |
|------|----------------|
| `base.py` | `Plugin` ABC |
| `manager.py` | `PluginManager`: subscribe, dispatch with isolation, start/stop |
| `registry.py` | name→class map + `build_enabled(settings)` |
| `plugins/logging_plugin.py` | logs each event (structlog); no external dep |
| `plugins/mqtt_plugin.py` | publish to MQTT (`aiomqtt`, lazy); topics from a prefix |
| `plugins/discord_plugin.py` | POST embed/message to a Discord webhook on leg/game won (`httpx`, lazy) |
| `plugins/wled_plugin.py` | POST a preset/effect to WLED on bust/game won (`httpx`, lazy) |
| `config.py` (modify) | `plugins_enabled`, `plugins` settings |
| `cli.py` (modify) | build + run enabled plugins in `serve` |
| `pyproject.toml` (modify) | `[project.optional-dependencies] integrations = ["aiomqtt","httpx"]` |
| `tests/integrations/...` | manager + each plugin (fakes) |

---

## 5. Topic / Payload Conventions

- **MQTT:** `<prefix>/throw` ← `dart_hit`; `<prefix>/game` ← `game_state`; `<prefix>/event` ←
  bust/leg_won/game_won/connection_state. Payload = the event's JSON. Default prefix `granboard`.
- **Discord:** on `leg_won`/`game_won`, POST `{ "content": "<message>" }` to `webhook_url`.
- **WLED:** on `game_won` POST `{"on":true,"seg":[{"fx":<celebration>}]}`, on `bust` a brief red
  flash, to `http://<host>/json/state`. (Effect ids are configurable; sensible defaults.)

All network plugins **no-op gracefully** when their endpoint isn't configured (empty url/host).

---

## 6. Testing

- **manager**: dispatches an event to all plugins; a plugin that raises in `handle` is isolated
  (others still receive it; manager keeps running). start/stop call through.
- **mqtt_plugin**: inject a fake client (constructor accepts an optional `client_factory`); assert
  `dart_hit` → publish to `granboard/throw` with the JSON payload; no-op if not started.
- **discord_plugin**: inject a fake async poster; assert `game_won` POSTs to the webhook with a
  content message; `dart_hit` does nothing; no webhook_url → no POST.
- **wled_plugin**: inject a fake poster; assert `game_won`/`bust` POST to `…/json/state`; no host → no-op.
- **logging_plugin**: captures/visits events without error.
- All CI-safe (no broker, no network).

---

## 7. Integration & No-Rework Note

Additive: a new `integrations/` package + small `config.py`/`cli.py`/`pyproject.toml` edits. The
bus, engine, and UI are untouched. Plugins consume the existing event contract.

---

## 8. Out of Scope (later)

Home Assistant MQTT discovery, Philips Hue, Twitch chat bot, sound packs, entry-point plugin
discovery, per-plugin sandboxing. All implementable later against the same `Plugin` interface.
