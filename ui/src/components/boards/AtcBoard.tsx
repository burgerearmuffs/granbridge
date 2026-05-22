import type { GameState } from "../../types";

function formatTarget(stage: number): string {
  if (stage === 21) return "BULL";
  if (stage >= 22) return "DONE";
  return String(stage);
}

export function AtcBoard({ state }: { state: GameState }) {
  const targets = (state.mode_view?.target ?? {}) as Record<string, number>;

  return (
    <div>
      <div className="flex gap-6 justify-center flex-wrap">
        {state.players.map((p, i) => (
          <div
            key={p.id}
            data-testid="player-card"
            className={`rounded-2xl px-8 py-6 bg-neutral-800/70 min-w-[180px] text-center ${
              i === state.active_index ? "ring-4 ring-amber-400" : ""
            }`}
          >
            <div className="text-2xl text-neutral-300">{p.name}</div>
            <div className="text-7xl font-extrabold text-white tabular-nums">
              {formatTarget(targets[p.id] ?? 1)}
            </div>
            <div className="text-sm text-neutral-400 mt-1 uppercase tracking-widest">Target</div>
          </div>
        ))}
      </div>
    </div>
  );
}
