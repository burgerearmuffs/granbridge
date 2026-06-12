from __future__ import annotations

from functools import lru_cache
from typing import Optional

# Preferred routes for common finishes (double-out). Values are dart beds.
_PREFERRED: dict[int, list[str]] = {
    170: ["T20", "T20", "BULL"], 167: ["T20", "T19", "BULL"], 164: ["T20", "T18", "BULL"],
    161: ["T20", "T17", "BULL"], 160: ["T20", "T20", "D20"], 158: ["T20", "T20", "D19"],
    100: ["T20", "D20"], 81: ["T19", "D12"], 80: ["T20", "D10"], 50: ["BULL"],
    40: ["D20"], 36: ["D18"], 32: ["D16"], 24: ["D12"], 20: ["D10"], 4: ["D2"], 2: ["D1"],
}
_BOGEY = {169, 168, 166, 165, 163, 162, 159}

_TREBLES = {f"T{n}": 3 * n for n in range(1, 21)}
_SINGLES = {**{f"S{n}": n for n in range(1, 21)}, "S25": 25}
_FINISHERS = {**{f"D{n}": 2 * n for n in range(1, 21)}, "BULL": 50}  # BULL = double-bull finish


def suggest(remaining: int, darts_left: int, double_out: bool) -> Optional[list[str]]:
    """Suggest a checkout for `remaining` within `darts_left`. None if impossible/bogey."""
    if not double_out:
        if 1 <= remaining <= 20:
            return [f"S{remaining}"]
        route = _PREFERRED.get(remaining)
        return route if route and len(route) <= darts_left else None
    if remaining > 170 or remaining in _BOGEY or remaining < 2:
        return None
    route = _PREFERRED.get(remaining)
    if route is not None:
        return route if len(route) <= darts_left else None
    found = _search(remaining, darts_left)
    return list(found) if found is not None else None


# Memoized: mode_view rebuilds checkout suggestions on every state emit, and the
# 3-dart search is ~33k combos. Domain is tiny (169 scores x 3 darts) so cache all.
# Returns a tuple so cached values can't be mutated by callers.
@lru_cache(maxsize=None)
def _search(remaining: int, darts_left: int) -> Optional[tuple[str, ...]]:
    found = _search_routes(remaining, darts_left)
    return tuple(found) if found is not None else None


def _search_routes(remaining: int, darts_left: int) -> Optional[list[str]]:
    setups = {**_TREBLES, **_SINGLES, **{f"D{n}": 2 * n for n in range(1, 21)}}
    for bed, val in _FINISHERS.items():            # 1 dart
        if val == remaining:
            return [bed]
    if darts_left < 2:
        return None
    for s_bed, s_val in setups.items():            # 2 darts
        for f_bed, f_val in _FINISHERS.items():
            if s_val + f_val == remaining:
                return [s_bed, f_bed]
    if darts_left < 3:
        return None
    for a_bed, a_val in setups.items():            # 3 darts
        for s_bed, s_val in setups.items():
            for f_bed, f_val in _FINISHERS.items():
                if a_val + s_val + f_val == remaining:
                    return [a_bed, s_bed, f_bed]
    return None
