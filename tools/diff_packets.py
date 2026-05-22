"""Diff two sets of captured frame bodies."""
from __future__ import annotations


def diff_frames(a: list[str], b: list[str]) -> dict[str, set[str]]:
    sa, sb = set(a), set(b)
    return {"only_a": sa - sb, "only_b": sb - sa, "shared": sa & sb}
