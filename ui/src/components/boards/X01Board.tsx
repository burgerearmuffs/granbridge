import type { GameState } from "../../types";
export function X01Board({ state }: { state: GameState }) {
  const scores = (state.mode_view?.scores ?? {}) as Record<string, number>;
  const checkout = state.mode_view?.checkout as string[] | null;
  return (
    <div>
      <div className="flex gap-6 justify-center flex-wrap">
        {state.players.map((p, i) => (
          <div key={p.id} className={`rounded-2xl px-8 py-6 bg-neutral-800/70 min-w-[180px] text-center ${i===state.active_index?"ring-4 ring-amber-400":""}`}>
            <div className="text-2xl text-neutral-300">{p.name}</div>
            <div className="text-7xl font-extrabold text-white tabular-nums">{scores[p.id]}</div>
          </div>
        ))}
      </div>
      {checkout && <div className="mt-6 text-center text-3xl text-amber-300">OUT: {checkout.join("  ")}</div>}
    </div>
  );
}
