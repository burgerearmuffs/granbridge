import { useEffect, useState } from "react";
import { Dartboard } from "../components/Dartboard";
import { apiBase } from "../apiBase";
import { Section, EmptyState } from "../components/Page";
import { throwsToCsv, exportFilename, downloadText } from "../stats/exporters";
import type { HistoryDump } from "../stats/exporters";

interface StatRow {
  player: string;
  games_played: number;
  wins: number;
  darts: number;
  total_scored: number;
  three_dart_avg: number;
}

interface GameRow {
  id: number | string;
  mode: string;
  players_json: string | string[];
  winner: string | null;
  started_at: string;
  ended_at: string | null;
}

function parsePlayers(players_json: string | string[]): string[] {
  if (Array.isArray(players_json)) return players_json;
  try {
    const parsed = JSON.parse(players_json);
    if (Array.isArray(parsed)) return parsed as string[];
    return [String(parsed)];
  } catch {
    return [String(players_json)];
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

async function fetchDump(): Promise<HistoryDump> {
  const res = await fetch(`${apiBase()}/api/history/export/all`);
  if (!res.ok) throw new Error(`Export request failed (${res.status}).`);
  return (await res.json()) as HistoryDump;
}

export function History() {
  const [stats, setStats] = useState<StatRow[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);
  const [heatmap, setHeatmap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport(kind: "json" | "csv") {
    setExportError(null);
    try {
      const dump = await fetchDump();
      if (kind === "json") {
        downloadText(JSON.stringify(dump, null, 2), exportFilename("json"), "application/json");
      } else {
        downloadText(throwsToCsv(dump), exportFilename("csv"), "text/csv");
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const base = apiBase();
        const [statsRes, recentRes, heatRes] = await Promise.all([
          fetch(`${base}/api/history/stats`),
          fetch(`${base}/api/history/recent`),
          fetch(`${base}/api/history/heatmap`),
        ]);

        if (!statsRes.ok || !recentRes.ok || !heatRes.ok) {
          throw new Error("One or more history API requests failed.");
        }

        const [statsData, recentData, heatData] = await Promise.all([
          statsRes.json() as Promise<StatRow[]>,
          recentRes.json() as Promise<GameRow[]>,
          heatRes.json() as Promise<Record<string, number>>,
        ]);

        if (!cancelled) {
          setStats(statsData);
          setGames(recentData);
          setHeatmap(heatData);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load history.");
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="text-center text-neutral-400 py-12" aria-live="polite">
        Loading history…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-red-400 py-12" role="alert">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Player Stats Table */}
      <Section heading="Player Stats">
        {stats.length === 0 ? (
          <EmptyState message="No stats recorded yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-neutral-400 border-b border-neutral-700">
                  <th className="text-left py-2 pr-4 font-semibold">Player</th>
                  <th className="text-right py-2 pr-4 font-semibold">Games</th>
                  <th className="text-right py-2 pr-4 font-semibold">Wins</th>
                  <th className="text-right py-2 font-semibold">3-Dart Avg</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((row) => (
                  <tr
                    key={row.player}
                    className="border-b border-neutral-800 hover:bg-neutral-900 transition-colors"
                  >
                    <td className="py-2 pr-4 font-medium">{row.player}</td>
                    <td className="py-2 pr-4 text-right text-neutral-300">
                      {row.games_played}
                    </td>
                    <td className="py-2 pr-4 text-right text-neutral-300">
                      {row.wins}
                    </td>
                    <td className="py-2 text-right text-amber-300 font-bold">
                      {row.three_dart_avg.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Recent Games */}
      <Section heading="Recent Games">
        {games.length === 0 ? (
          <EmptyState message="No games recorded yet." />
        ) : (
          <ul className="space-y-2">
            {games.map((game) => {
              const players = parsePlayers(game.players_json);
              return (
                <li
                  key={game.id}
                  className="flex flex-wrap items-center gap-3 bg-neutral-900 rounded-lg px-4 py-3 text-sm"
                >
                  <span className="uppercase font-bold text-neutral-400 tracking-wider text-xs">
                    {game.mode}
                  </span>
                  <span className="text-neutral-300">
                    {players.join(" vs ")}
                  </span>
                  {game.winner && (
                    <span className="text-amber-300 font-semibold">
                      Winner: {game.winner}
                    </span>
                  )}
                  <span className="ml-auto text-neutral-500 text-xs">
                    {formatDate(game.started_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Export */}
      <Section heading="Export Your Data">
        <p className="text-neutral-500 text-sm mb-3">
          Download your complete match history — every game and every dart. JSON is the
          canonical dump; CSV is one row per throw for spreadsheets.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleExport("json")}
            className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm font-semibold
                       border border-neutral-700 focus:outline-none focus-visible:ring-2
                       focus-visible:ring-amber-400"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => void handleExport("csv")}
            className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm font-semibold
                       border border-neutral-700 focus:outline-none focus-visible:ring-2
                       focus-visible:ring-amber-400"
          >
            Export CSV
          </button>
        </div>
        {exportError && (
          <p role="alert" className="text-red-400 text-sm mt-3">
            {exportError}
          </p>
        )}
      </Section>

      {/* Heatmap Dartboard */}
      <Section heading="Hit Heatmap">
        <p className="text-neutral-500 text-sm mb-4">
          Aggregate dart landing distribution across all recorded games.
        </p>
        <div className="flex justify-center">
          <Dartboard heatmap={heatmap} />
        </div>
      </Section>
    </div>
  );
}
