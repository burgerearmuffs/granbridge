/**
 * Own-your-data exporters for the /api/history/export/all dump.
 *
 * JSON export is the canonical dump verbatim; CSV flattens to one row per
 * throw (spreadsheet/analysis friendly), RFC 4180 quoting.
 */

export interface ExportedThrow {
  player: string;
  bed: string;
  score: number;
  ts: string;
}

export interface ExportedGame {
  id: number;
  mode: string;
  players: string[];
  options: Record<string, unknown>;
  winner: string | null;
  started_at: string;
  ended_at: string | null;
  throws: ExportedThrow[];
}

export interface HistoryDump {
  schema: string;
  exported_at: string;
  games: ExportedGame[];
}

function csvField(value: string | number | null): string {
  if (value === null) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADER = "game_id,mode,players,winner,started_at,ended_at,player,bed,score,ts";

export function throwsToCsv(dump: HistoryDump): string {
  const rows = [CSV_HEADER];
  for (const g of dump.games) {
    const players = g.players.join(" | ");
    for (const t of g.throws) {
      rows.push(
        [
          csvField(g.id),
          csvField(g.mode),
          csvField(players),
          csvField(g.winner),
          csvField(g.started_at),
          csvField(g.ended_at),
          csvField(t.player),
          csvField(t.bed),
          csvField(t.score),
          csvField(t.ts),
        ].join(","),
      );
    }
  }
  return rows.join("\n") + "\n";
}

export function exportFilename(ext: "json" | "csv", now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return `granbridge-history-${date}.${ext}`;
}

/** Trigger a browser download of `text` as `filename`. */
export function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
