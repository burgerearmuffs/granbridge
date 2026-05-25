import { useEffect, useRef, useState } from "react";
import type { GameState } from "../types";
import { useStore } from "../store";
import { X01Board } from "../components/boards/X01Board";
import { CricketBoard } from "../components/boards/CricketBoard";
import { AtcBoard } from "../components/boards/AtcBoard";
import { FreePlayBoard } from "../components/boards/FreePlayBoard";
import { CountUpBoard } from "../components/boards/CountUpBoard";
import { MedleyBoard } from "../components/boards/MedleyBoard";
import { Dartboard } from "../components/Dartboard";

const HERO_DURATION_MS = 2500;

interface Props {
  state: GameState;
}

export function LiveGame({ state }: Props) {
  const activePlayer = state.players[state.active_index];
  const lastHit = useStore((s) => s.lastHit);
  const banners = useStore((s) => s.banners);
  const [boardHero, setBoardHero] = useState(false);
  const heroTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect reduced-motion preference (guarded for jsdom which lacks matchMedia)
  const prefersReducedMotion = useRef(
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  );

  // Watch banners for the latest leg_won / game_won; trigger the hero swing.
  // Keyed on the newest banner's monotonic `at` (not array length): the store caps
  // `banners` at 5, so a length-growth check stops firing once the cap is reached.
  const lastWinAtRef = useRef<number>(banners.length ? banners[banners.length - 1].at : 0);
  useEffect(() => {
    const latest = banners[banners.length - 1];
    if (!latest) return;
    if (latest.kind !== "leg_won" && latest.kind !== "game_won") return;
    if (latest.at <= lastWinAtRef.current) return; // already reacted to this win
    lastWinAtRef.current = latest.at;
    if (prefersReducedMotion.current) return;

    setBoardHero(true);
    if (heroTimerRef.current !== null) clearTimeout(heroTimerRef.current);
    heroTimerRef.current = setTimeout(() => {
      setBoardHero(false);
      heroTimerRef.current = null;
    }, HERO_DURATION_MS);
  }, [banners]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (heroTimerRef.current !== null) clearTimeout(heroTimerRef.current);
    };
  }, []);

  const board = () => {
    switch (state.mode) {
      case "x01":
        return <X01Board state={state} />;
      case "cricket":
        return <CricketBoard state={state} />;
      case "around_the_clock":
        return <AtcBoard state={state} />;
      case "free_play":
        return <FreePlayBoard state={state} />;
      case "count_up":
        return <CountUpBoard state={state} />;
      case "medley":
        return <MedleyBoard state={state} />;
      default:
        return (
          <div className="text-center text-neutral-400 py-8">
            Unknown mode: {state.mode}
          </div>
        );
    }
  };

  return (
    <div className="space-y-8">
      {activePlayer && (
        <div className="text-center">
          <span className="text-lg text-amber-300 font-semibold uppercase tracking-widest">
            {activePlayer.name}
          </span>
          <span className="text-neutral-500 text-sm ml-2">throwing</span>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-8 items-start justify-center">
        {/* Mode-specific scoreboard */}
        <div className="flex-1 min-w-0">
          {board()}
        </div>

        {/* Dartboard panel */}
        <div className="flex flex-col items-center gap-3 lg:w-64 xl:w-72">
          <Dartboard highlight={lastHit?.bed} tilt={boardHero ? "hero" : "play"} dart={lastHit?.bed} />
          {lastHit && (
            <div className="text-center">
              <span className="text-amber-300 font-bold text-lg score-pop">
                {lastHit.bed}
              </span>
              {lastHit.score > 0 && (
                <span className="text-neutral-400 text-sm ml-2">
                  +{lastHit.score}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
