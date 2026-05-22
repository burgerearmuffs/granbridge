import type { GameState } from "../../types";
import { X01Board } from "./X01Board";
import { CricketBoard } from "./CricketBoard";
import { AtcBoard } from "./AtcBoard";
import { CountUpBoard } from "./CountUpBoard";

const LABELS: Record<string, string> = {
  x01: "X01",
  cricket: "Cricket",
  around_the_clock: "Around the Clock",
  count_up: "Count-Up",
};

export function MedleyBoard({ state }: { state: GameState }) {
  const medley = state.mode_view?.medley as
    | { sequence: string[]; index: number; current: string }
    | undefined;

  if (!medley) {
    return <div className="text-center text-neutral-400 py-8">Medley starting…</div>;
  }

  const sub = () => {
    switch (medley.current) {
      case "x01":
        return <X01Board state={state} />;
      case "cricket":
        return <CricketBoard state={state} />;
      case "around_the_clock":
        return <AtcBoard state={state} />;
      case "count_up":
        return <CountUpBoard state={state} />;
      default:
        return <div className="text-center text-neutral-400">Unknown game: {medley.current}</div>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center text-sm text-amber-300 uppercase tracking-widest font-semibold">
        Game {medley.index + 1} / {medley.sequence.length} — {LABELS[medley.current] ?? medley.current}
      </div>
      {sub()}
    </div>
  );
}
