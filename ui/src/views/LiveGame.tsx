import type { GameState } from "../types";
import { X01Board } from "../components/boards/X01Board";
import { CricketBoard } from "../components/boards/CricketBoard";
import { AtcBoard } from "../components/boards/AtcBoard";
import { FreePlayBoard } from "../components/boards/FreePlayBoard";

interface Props {
  state: GameState;
}

export function LiveGame({ state }: Props) {
  const activePlayer = state.players[state.active_index];

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
      {board()}
    </div>
  );
}
