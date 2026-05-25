import type { GameState } from "../../types";

const DEFAULT_NUMBERS = ["20", "19", "18", "17", "16", "15", "B"];

/** Render 0–3 marks as pip characters; 3 = CLOSED */
function MarksCell({ count }: { count: number }) {
  if (count >= 3) {
    return (
      <span className="text-emerald-400 font-black text-sm tracking-widest">
        CLOSED
      </span>
    );
  }
  if (count === 0) {
    return <span className="text-neutral-600 text-sm">—</span>;
  }
  // 1 mark = "/", 2 marks = "/ /"
  return (
    <span className="text-amber-300 font-semibold text-lg tracking-widest">
      {Array.from({ length: count }, (_, i) => (
        <span key={i}>/</span>
      ))}
    </span>
  );
}

export function CricketBoard({ state }: { state: GameState }) {
  const mv = state.mode_view ?? {};
  const numbers: string[] = mv.numbers ?? DEFAULT_NUMBERS;
  const marks = (mv.marks ?? {}) as Record<string, Record<string, number>>;
  const points = (mv.points ?? {}) as Record<string, number>;

  return (
    <div className="overflow-x-auto">
      <table className="mx-auto border-separate border-spacing-0 text-white">
        <thead>
          <tr>
            {/* empty top-left corner cell for the row-label column */}
            <th className="w-16 py-3 text-neutral-500 text-xs uppercase tracking-widest font-semibold" />
            {state.players.map((p, i) => (
              <th
                key={p.id}
                data-testid="player-header"
                data-active={i === state.active_index ? "true" : "false"}
                className={`min-w-[120px] py-3 px-4 text-center rounded-t-xl text-xl font-bold bg-neutral-800/70 ${
                  i === state.active_index
                    ? "ring-4 ring-amber-400"
                    : ""
                }`}
              >
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* One row per cricket number */}
          {numbers.map((num) => (
            <tr key={num} className="group">
              <td className="py-3 px-3 text-center text-xl font-black text-neutral-300 bg-neutral-900/60 border-b border-neutral-800">
                {num}
              </td>
              {state.players.map((p, i) => {
                const count = marks[p.id]?.[num] ?? 0;
                return (
                  <td
                    key={p.id}
                    className={`py-3 px-4 text-center bg-neutral-800/40 border-b border-neutral-800 ${
                      i === state.active_index ? "bg-neutral-700/60" : ""
                    }`}
                  >
                    <MarksCell count={count} />
                  </td>
                );
              })}
            </tr>
          ))}

          {/* Points row */}
          <tr>
            <td className="py-3 px-3 text-center text-xs uppercase tracking-widest text-neutral-500 font-semibold bg-neutral-900/60">
              Pts
            </td>
            {state.players.map((p, i) => (
              <td
                key={p.id}
                className={`py-3 px-4 text-center text-3xl font-extrabold tabular-nums bg-neutral-800/70 rounded-b-xl ${
                  i === state.active_index ? "text-amber-300" : "text-white"
                }`}
              >
                <span key={points[p.id] ?? 0} data-score className="score-pop">
                  {points[p.id] ?? 0}
                </span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
