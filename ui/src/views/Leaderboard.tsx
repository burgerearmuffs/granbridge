import { useEffect, useState } from "react";
import { Avatar } from "../components/Avatar";
import { fetchLeaderboard } from "../stats/statsClient";
import { defaultAvatarColor } from "../multiplayer/avatar";
import type { LeaderRow } from "../stats/types";
import { PageHeader, EmptyState } from "../components/Page";

type Metric = "avg" | "wins";

export function Leaderboard() {
  const [metric, setMetric] = useState<Metric>("avg");
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(false);
    fetchLeaderboard(metric)
      .then((r) => { if (!cancelled) setRows(r.players); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [metric]);

  const tabClass = (active: boolean) =>
    [
      "px-3 py-1.5 rounded-full text-sm font-semibold transition-colors",
      active ? "bg-amber-400 text-neutral-900" : "text-neutral-400 hover:text-white hover:bg-neutral-800",
    ].join(" ");

  return (
    <div className="max-w-2xl mx-auto mt-8 space-y-4">
      <div className="flex items-center justify-between">
        <PageHeader title="Leaderboard" />
        <div className="flex gap-1" role="group" aria-label="metric">
          <button aria-pressed={metric === "avg"} onClick={() => setMetric("avg")} className={tabClass(metric === "avg")}>
            3-Dart Avg
          </button>
          <button aria-pressed={metric === "wins"} onClick={() => setMetric("wins")} className={tabClass(metric === "wins")}>
            Wins
          </button>
        </div>
      </div>
      <p className="text-neutral-500 text-xs">Only verified (co-signed) matches rank here.</p>

      {error ? (
        <p role="alert" className="text-red-300 text-sm">Couldn't reach the stats server.</p>
      ) : rows === null ? (
        <p className="text-neutral-400 animate-pulse">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState message="No verified matches yet." />
      ) : (
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center gap-3 bg-neutral-900 rounded-lg px-4 py-2">
              <span className="w-6 text-neutral-500 tabular-nums">{i + 1}</span>
              <Avatar name={r.display_name ?? "?"} color={r.avatar_color ?? defaultAvatarColor(r.id)} size={36} />
              <span className="flex-1 font-semibold">{r.display_name ?? "Anonymous"}</span>
              <span className="text-amber-300 font-bold tabular-nums">
                {metric === "avg" ? r.three_dart_avg.toFixed(1) : r.wins}
              </span>
              <span className="w-16 text-right text-xs text-neutral-500">{r.games}g</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
