import { useState } from "react";
import type { Command } from "../types";
export function Controls({ send }: { send: (c: Command) => void }) {
  const [bed, setBed] = useState("");
  const btn = "rounded-xl px-5 py-3 text-lg font-semibold bg-neutral-700 hover:bg-neutral-600 text-white";
  return (
    <div className="flex gap-3 items-center flex-wrap justify-center">
      <button className={btn} onClick={() => send({ command: "next_player" })}>Next</button>
      <button className={btn} onClick={() => send({ command: "record_miss" })}>Miss</button>
      <button className={btn} onClick={() => send({ command: "undo" })}>Undo</button>
      <button className={btn} onClick={() => send({ command: "end_game" })}>End</button>
      <input aria-label="bed" className="rounded-xl px-3 py-3 text-black w-24" value={bed} onChange={(e)=>setBed(e.target.value)} placeholder="T20" />
      <button className={btn} onClick={() => { if (bed) send({ command: "correct_last", bed: bed.toUpperCase() }); }}>Correct</button>
    </div>
  );
}
