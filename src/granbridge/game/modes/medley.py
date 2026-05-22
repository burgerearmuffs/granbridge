from __future__ import annotations

from typing import Any

from granbridge.game.models import Dart, GameState
from granbridge.game.modes.around_the_clock import AroundTheClockMode
from granbridge.game.modes.base import DartResult, GameMode
from granbridge.game.modes.count_up import CountUpMode
from granbridge.game.modes.cricket import CricketMode
from granbridge.game.modes.x01 import X01Mode

# Leg-ending sub-modes only (free_play never ends a leg; medley would recurse).
_SUB_MODES: dict[str, type[GameMode]] = {
    "x01": X01Mode,
    "cricket": CricketMode,
    "around_the_clock": AroundTheClockMode,
    "count_up": CountUpMode,
}

DEFAULT_SEQUENCE = ["x01", "cricket", "count_up"]


class MedleyMode(GameMode):
    """A match of a sequence of games, one per leg, run by the engine's best-of-legs logic.

    Instance-stateless: the sequence + index live in state.mode_view["medley"], so undo
    (which re-instantiates the mode from the registry) is safe. Sets best_of_legs to the
    sequence length so the engine ends the match at the first player to win a majority of legs.
    """

    name = "medley"

    def on_start(self, state: GameState, options: dict) -> None:
        prior = state.mode_view.get("medley") if isinstance(state.mode_view, dict) else None
        if prior is None:
            sequence = list(options.get("sequence") or DEFAULT_SEQUENCE)
            for m in sequence:
                if m not in _SUB_MODES:
                    raise ValueError(f"unknown medley sub-mode {m!r}")
            index = 0
            state.options = {**state.options, **options}
            state.options["best_of_legs"] = len(sequence)
            state.options["best_of_sets"] = 1
            leg_history: list[dict] = []
        else:
            sequence = prior["sequence"]
            index = prior["index"] + 1
            # Snapshot the outgoing sub-mode's view before it is overwritten.
            outgoing = prior["current"]
            outgoing_view = _SUB_MODES[outgoing]().mode_view(state)
            outgoing_view.pop("medley", None)
            leg_history = list(prior.get("leg_history", []))
            leg_history.append({"mode": outgoing, "view": outgoing_view})

        current = sequence[index]
        _SUB_MODES[current]().on_start(state, options)            # sets the sub-mode's mode_view keys
        state.mode_view["medley"] = {
            "sequence": sequence,
            "index": index,
            "current": current,
            "leg_history": leg_history,
        }

    def apply_dart(self, state: GameState, dart: Dart) -> DartResult:
        current = state.mode_view["medley"]["current"]
        return _SUB_MODES[current]().apply_dart(state, dart)

    def mode_view(self, state: GameState) -> dict[str, Any]:
        medley = state.mode_view["medley"]
        # Start with historical leg data so prior-leg keys (e.g. "total" from count_up) remain accessible.
        view: dict[str, Any] = {}
        for leg in medley.get("leg_history", []):
            view.update(leg["view"])
        # Overlay the live sub-mode view (current leg's keys overwrite history).
        view.update(_SUB_MODES[medley["current"]]().mode_view(state))
        view["medley"] = medley
        return view
