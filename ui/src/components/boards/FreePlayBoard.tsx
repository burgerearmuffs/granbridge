import type { GameState } from "../../types";

export function FreePlayBoard({ state }: { state: GameState }) {
  const totals = (state.mode_view?.total ?? {}) as Record<string, number>;
  const hits = (state.mode_view?.hits ?? {}) as Record<string, Record<string, number>>;

  return (
    <div>
      <div className="flex gap-6 justify-center flex-wrap">
        {state.players.map((p, i) => {
          const playerHits = hits[p.id] ?? {};
          const topBeds = Object.entries(playerHits)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);

          return (
            <div
              key={p.id}
              data-player={p.id}
              className={`rounded-2xl px-8 py-6 bg-neutral-800/70 min-w-[180px] text-center ${
                i === state.active_index ? "ring-4 ring-amber-400" : ""
              }`}
            >
              <div className="text-2xl text-neutral-300">{p.name}</div>
              <div className="text-7xl font-extrabold text-white tabular-nums">
                {totals[p.id] ?? 0}
              </div>
              {topBeds.length > 0 && (
                <div className="mt-4 space-y-1">
                  {topBeds.map(([bed, count]) => (
                    <div key={bed} className="flex justify-between text-lg text-neutral-300 px-2">
                      <span>{bed}</span>
                      <span className="text-amber-300 font-semibold">×{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
