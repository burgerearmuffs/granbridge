import type { GameState } from "../../types";

export function CountUpBoard({ state }: { state: GameState }) {
  const total = (state.mode_view?.total ?? {}) as Record<string, number>;
  const currentRound = (state.mode_view?.current_round ?? 1) as number;
  const rounds = (state.mode_view?.rounds ?? 8) as number;
  const max = Math.max(0, ...Object.values(total));

  return (
    <div>
      <div className="text-center text-sm text-neutral-400 uppercase tracking-widest mb-4">
        Round {currentRound} / {rounds}
      </div>
      <div className="flex gap-6 justify-center flex-wrap">
        {state.players.map((p, i) => {
          const score = total[p.id] ?? 0;
          const isLeader = max > 0 && score === max;
          return (
            <div
              key={p.id}
              data-player={p.id}
              data-active={i === state.active_index ? "true" : "false"}
              className={`rounded-2xl px-8 py-6 bg-neutral-800/70 min-w-[180px] text-center ${
                i === state.active_index ? "ring-4 ring-amber-400" : ""
              }`}
            >
              <div className="text-2xl text-neutral-300 flex items-center justify-center gap-2">
                {p.name}
                {isLeader && <span aria-label="leader" title="Leader">👑</span>}
              </div>
              <div
                key={score}
                data-score
                className="text-7xl font-extrabold text-white tabular-nums score-pop"
              >
                {score}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
