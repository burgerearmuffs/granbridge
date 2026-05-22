# GRANBRIDGE OBS Overlay Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Subagent does NOT commit. All overlays are transparent, safe-DOM (NO `innerHTML`), and load `common.js` relatively.

**Goal:** A suite of OBS browser-source overlays driven by the WebSocket, sharing one WS helper, plus a launcher page and Python asset tests.

**Tech:** Static HTML/CSS/JS (no build step) + Python pytest asset checks.

---

## Task 1: Shared WS helper `src/granbridge/overlay/common.js`

```js
// GRANBRIDGE overlay helper: connect to the bridge WS with auto-reconnect.
// Usage: connectGranbridge((event) => { ... }, { port: 8787 });
function connectGranbridge(onEvent, opts) {
  const port = (opts && opts.port) || 8787;
  let ws;
  function connect() {
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch (e) { /* ignore */ } };
    ws.onclose = () => setTimeout(connect, 1000);
    ws.onopen = () => onEvent({ type: "_open" });
  }
  connect();
  return { close: () => ws && ws.close() };
}
window.connectGranbridge = connectGranbridge;
```

---

## Tasks 2–6: Overlays (one file each). Each: transparent bg, `<script src="common.js"></script>`, then `connectGranbridge(onEvent)`; build DOM with `createElement`/`textContent`/`replaceChildren`; NEVER `innerHTML`. Follow the existing `overlay/game.html` style.

- **Task 2 `src/granbridge/overlay/scoreboard.html`** — on `game_state`, render each player (name + score: `state.mode_view.scores[id]` for X01, else `state.mode_view.points[id]` for Cricket, else blank); highlight `active_index`. Must reference `game_state` and `common.js`.
- **Task 3 `src/granbridge/overlay/checkout.html`** — on `game_state`, show `state.mode_view.checkout` joined ("OUT: T20 D20"); hide when null/absent. References `game_state`, `checkout`, `common.js`.
- **Task 4 `src/granbridge/overlay/throw.html`** — on `dart_hit`, show `ev.bed` + `ev.score` large, with a CSS pop/fade animation (re-trigger by toggling a class). References `dart_hit`, `common.js`.
- **Task 5 `src/granbridge/overlay/stats.html`** — on `game_state`, list each player's `state.stats[id].three_dart_avg` and `state.stats[id].darts`. References `game_state`, `three_dart_avg`, `common.js`.
- **Task 6 `src/granbridge/overlay/lower-third.html`** — on `game_started` or `game_state`, show "Now playing: <mode>" + player names. References `game_started` (or `game_state`), `common.js`.

---

## Task 7: Launcher + asset tests

- **`src/granbridge/overlay/launcher.html`** — a non-transparent index page listing every overlay
  (`index.html`, `game.html`, `broadcast.html`, `scoreboard.html`, `checkout.html`, `throw.html`,
  `stats.html`, `lower-third.html`) as links, with a short "Add as an OBS Browser Source pointing at
  this local file; size to your scene; transparent background" note. Use safe DOM or static markup
  (static `<a>` tags are fine; no dynamic innerHTML).
- **`tests/overlay/test_overlays.py`** (+ `tests/overlay/__init__.py`):
```python
from pathlib import Path
import pytest

OVERLAY = Path("src/granbridge/overlay")

CASES = {
    "scoreboard.html": ["game_state"],
    "checkout.html": ["game_state", "checkout"],
    "throw.html": ["dart_hit"],
    "stats.html": ["game_state", "three_dart_avg"],
    "lower-third.html": ["game"],  # game_started or game_state
}

@pytest.mark.parametrize("fname,needles", CASES.items())
def test_overlay_contract(fname, needles):
    html = (OVERLAY / fname).read_text(encoding="utf-8")
    assert "common.js" in html, f"{fname} must load common.js"
    assert "innerHTML" not in html, f"{fname} must use safe DOM"
    for n in needles:
        assert n in html, f"{fname} must reference {n}"

def test_common_js_exports_helper():
    assert "connectGranbridge" in (OVERLAY / "common.js").read_text(encoding="utf-8")

def test_launcher_lists_overlays():
    html = (OVERLAY / "launcher.html").read_text(encoding="utf-8")
    for f in ["scoreboard.html", "checkout.html", "throw.html", "stats.html", "lower-third.html",
              "game.html", "broadcast.html"]:
        assert f in html
```
- Run `.venv\Scripts\python -m pytest tests/overlay -v` → pass.

---

## Self-Review
- **Spec coverage:** shared helper (T1), 5 overlays (T2–6), launcher (T7), asset tests (T7). All criteria mapped.
- **Placeholders:** common.js + tests have full code; overlays specified by precise behavior + the shared safe-DOM/common.js contract the test enforces.
- **Safety:** the asset test fails any overlay containing `innerHTML`; helper ignores malformed messages.
