import { useState } from "react";
import type { GameState } from "../types";
import type { GuestAction } from "../multiplayer/remoteMatch";

export function GuestControls({ state, guestSlot, onAction }: {
  state: GameState; guestSlot: string; onAction: (action: GuestAction, bed?: string) => void;
}) {
  const [bed, setBed] = useState("");
  const myTurn = state.players[state.active_index]?.id === guestSlot;
  const hasThrow = state.visit.length > 0;

  if (state.status === "finished") {
    return (
      <div className="flex gap-2">
        <button onClick={() => onAction("rematch", undefined)}
          className="px-4 py-2 rounded-lg bg-amber-400 text-neutral-900 font-bold text-sm hover:bg-amber-300">
          Rematch
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => onAction("miss", undefined)} disabled={!myTurn}
        className="px-3 py-2 rounded-lg bg-neutral-800 text-sm hover:bg-neutral-700 disabled:opacity-40">Miss</button>
      <button onClick={() => onAction("undo", undefined)} disabled={!myTurn || !hasThrow}
        className="px-3 py-2 rounded-lg bg-neutral-800 text-sm hover:bg-neutral-700 disabled:opacity-40">Undo</button>
      <input aria-label="Correct bed" value={bed} onChange={(e) => setBed(e.target.value)}
        placeholder="T20" className="w-20 bg-neutral-800 rounded-lg px-2 py-2 text-sm font-mono" />
      <button onClick={() => { if (bed.trim()) { onAction("correct", bed.trim().toUpperCase()); setBed(""); } }}
        disabled={!myTurn || !hasThrow}
        className="px-3 py-2 rounded-lg bg-neutral-800 text-sm hover:bg-neutral-700 disabled:opacity-40">Correct</button>
    </div>
  );
}
