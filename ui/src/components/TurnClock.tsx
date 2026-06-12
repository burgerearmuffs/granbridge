/**
 * TurnClock — advisory per-turn countdown for multiplayer matches.
 *
 * Counts down from `seconds` and restarts whenever the active player (or leg)
 * changes. Purely visual: it never auto-advances the turn — the host's board
 * stays authoritative. Amber normally, red and pulsing in the final 5 seconds,
 * "0:00" once expired.
 */

import { useEffect, useState } from "react";

export interface TurnClockProps {
  /** Per-turn allowance in seconds (0/undefined = render nothing). */
  seconds: number;
  /** Changes whenever the countdown should restart (active player / leg / game). */
  resetKey: string;
  /** Pause (e.g. when the game isn't in progress). */
  running: boolean;
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function TurnClock({ seconds, resetKey, running }: TurnClockProps) {
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    setLeft(seconds);
    if (!running || seconds <= 0) return;
    const id = setInterval(() => {
      setLeft((v) => (v > 0 ? v - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [seconds, resetKey, running]);

  if (seconds <= 0) return null;

  const urgent = left <= 5;
  const warn = left <= 10 && !urgent;
  return (
    <span
      role="timer"
      aria-label={`Turn clock: ${fmt(left)} remaining`}
      className={[
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold tabular-nums",
        urgent
          ? "bg-red-900/70 text-red-200 animate-pulse"
          : warn
            ? "bg-amber-900/70 text-amber-200"
            : "bg-neutral-800 text-neutral-200",
      ].join(" ")}
    >
      ⏱ {fmt(left)}
    </span>
  );
}
