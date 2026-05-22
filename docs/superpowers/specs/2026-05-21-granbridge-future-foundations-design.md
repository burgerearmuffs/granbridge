# GRANBRIDGE — Sub-project 6: "Future Foundations" (Design Spec)

- **Date:** 2026-05-21 · Self-approved under the autonomous-build mandate.
- **Depends on:** SP1 (bus/WS/events), SP2 (game events), SP4 (plugin interface).
- **Guardrail:** local only. External needs (public relay hosting, LLM API key, TTS, cameras, CV
  libraries) are built *up to the seam*, stubbed, and flagged — never wired to an external service here.

This sub-project lays the groundwork for the three "future" areas in the original brief
(online multiplayer, AI commentary, camera validation), building everything that is locally
buildable + testable and documenting/seaming the rest.

---

## Part A — Online Multiplayer (local relay; buildable + testable)

**Goal:** Multiple GRANBRIDGE instances share game state over a room, so a remote viewer/second
location can spectate/sync. MVP = host-authoritative event broadcast.

- **`net/relay_server.py` — `RelayServer`**: a `websockets` server. A client connects with
  `?room=<id>`; any message it sends is rebroadcast (JSON, verbatim) to all OTHER clients in the
  same room. No persistence, no auth (localhost/LAN MVP). Methods `start()`/`stop()` like the WS server.
- **`net/relay_plugin.py` — `RelayPlugin`** (a SP4 `Plugin`): connects as a client to a relay
  (`config.url`, `config.room`) and forwards each local bus event to the room. `httpx`/`websockets`
  client, imported lazily; injectable sender for tests; no-op when `url` unset.
- **CLI `granbridge relay`**: run a `RelayServer` on a host/port (default `127.0.0.1:8788`).

**Success:** two local websocket clients in the same room — a message from one is received by the
other (and not echoed to the sender, and not leaked across rooms). `RelayPlugin` forwards a bus
event to its injected sender. **Flagged:** exposing the relay beyond localhost needs hosting + auth
+ TLS (out of scope; documented).

---

## Part B — AI Commentary (offline template real; LLM seam stubbed)

**Goal:** Generate commentary lines from game events; emit them as `commentary` events (consumable
by overlays / a future TTS).

- **`commentary/events.py` — `Commentary`** event (`type:"commentary"`, `text:str`, `tone:str`),
  added to `schema_export`.
- **`commentary/commentator.py`**: `Commentator` ABC (`comment(event) -> str | None`) +
  **`TemplateCommentator`** (real, offline): rules like `dart_hit` T20→"Treble twenty!", a 180 visit,
  `bust`→"No score!", `game_won`→"Game shot, <player>!". Pure + table-driven, fully testable.
  + **`LLMCommentator`** interface stub: ctor takes a `generate` callable (injected); if absent it
  raises a clear "needs an LLM client/API key" error on use. **Flagged**, not wired to any provider.
- **`commentary/plugin.py` — `CommentaryPlugin`** (SP4 `Plugin`): on each event, runs the configured
  commentator and, if it returns a line, emits a `Commentary` event. (It is the one plugin allowed to
  publish, via an injected `publish` callable, to avoid feedback loops — it never comments on its own
  `commentary` events.)

**Success:** `TemplateCommentator` returns expected lines for T20/180/bust/game_won and `None` for
uninteresting events; `CommentaryPlugin` publishes a `Commentary` for a commented event and ignores
`commentary` events. **Flagged:** LLM commentary needs an API key/provider; TTS is a follow-up.

---

## Part C — Camera CV Validation (architecture + seam only)

**Goal:** Document how a computer-vision dart-validation subsystem would integrate, and provide the
interface seam — without implementing CV (no cameras here; the user chose player-cams over CV
autoscoring, so CV validation remains deferred/architecture-only).

- **`vision/validator.py`**: `Validator` ABC (`validate(dart_hit) -> ValidationResult`) +
  **`NoOpValidator`** (always `agreed=True`). `ValidationResult{agreed:bool, detected_bed:str|None,
  confidence:float}`. This is the seam a future CV validator (2–3 cameras, calibration, multi-view
  dart-tip detection) would implement; the engine could later cross-check BLE scores against it and
  emit a `validation` event.
- **`docs/camera-validation-architecture.md`**: the design — camera rig, calibration, detection
  pipeline, where it plugs into the event flow, and why it's deferred (hardware + heavy CV deps:
  opencv/numpy; competes with the board's own sensors).

**Success:** `NoOpValidator.validate(...)` returns `agreed=True`; the architecture doc exists.
**Flagged:** real CV needs cameras + opencv/numpy + calibration — explicitly out of scope.

---

## Testing & Integration

All testable parts are CI-safe (local sockets / injected fakes / pure logic). Additive packages
(`net/`, `commentary/`, `vision/`) + `schema_export`/`cli` edits + the `RelayPlugin`/`CommentaryPlugin`
registered in the SP4 registry. The bus/engine/UI are otherwise untouched.

## Out of Scope (flagged for the user)
Public/relay hosting + auth + TLS; LLM provider wiring + API key; TTS voice; real camera CV
(hardware + opencv). Each has a working local seam/stub so the future build is drop-in.
