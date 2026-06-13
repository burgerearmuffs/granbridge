/**
 * Match-result sharing — pure builders for a text summary and a PNG card.
 * No React; canvas drawing is guarded so jsdom (null 2D context) is a no-op.
 */

import type { GameState } from "../types";

export interface ResultSummary {
  modeLabel: string;
  winnerName: string | null;
  lines: Array<{ name: string; legs: number; avg: number; darts: number }>;
}

const MODE_LABELS: Record<string, string> = {
  x01: "X01",
  cricket: "Cricket",
  around_the_clock: "Around the Clock",
  count_up: "Count-Up",
  free_play: "Free Play",
  medley: "Medley",
};

/** Distill a finished GameState into the bits worth sharing. */
export function summarizeResult(state: GameState): ResultSummary {
  const start = state.options?.["start_score"];
  const base = MODE_LABELS[state.mode] ?? state.mode;
  const modeLabel = state.mode === "x01" && typeof start === "number" ? `${base} ${start}` : base;
  const winnerName = state.winner
    ? state.players.find((p) => p.id === state.winner)?.name ?? null
    : null;
  const lines = state.players.map((p) => ({
    name: p.name,
    legs: state.legs?.[p.id] ?? 0,
    avg: state.stats?.[p.id]?.three_dart_avg ?? 0,
    darts: state.stats?.[p.id]?.darts ?? 0,
  }));
  return { modeLabel, winnerName, lines };
}

/** Plain-text result (clipboard / paste-anywhere). */
export function buildResultText(state: GameState): string {
  const s = summarizeResult(state);
  const out: string[] = [`🎯 GRANBRIDGE — ${s.modeLabel}`];
  if (s.winnerName) out.push(`🏆 ${s.winnerName} wins`);
  const showLegs = s.lines.some((l) => l.legs > 0);
  for (const l of s.lines) {
    const legs = showLegs ? `${l.legs} leg${l.legs === 1 ? "" : "s"} · ` : "";
    out.push(`${l.name}: ${legs}${l.avg.toFixed(1)} three-dart avg (${l.darts} darts)`);
  }
  return out.join("\n");
}

const W = 800;
const H = 420;

/** Draw the PNG share card. Returns null when canvas 2D is unavailable (tests). */
export function drawResultCard(state: GameState): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const s = summarizeResult(state);

  // Background + accent rail
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fbbf24";
  ctx.fillRect(0, 0, 8, H);

  // Brand + mode
  ctx.fillStyle = "#fbbf24";
  ctx.font = "900 34px system-ui, Segoe UI, sans-serif";
  ctx.fillText("GRANBRIDGE", 48, 70);
  ctx.fillStyle = "#a3a3a3";
  ctx.font = "600 22px system-ui, Segoe UI, sans-serif";
  ctx.fillText(s.modeLabel, 48, 104);

  // Winner
  if (s.winnerName) {
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 44px system-ui, Segoe UI, sans-serif";
    ctx.fillText(`🏆 ${s.winnerName} wins`, 48, 175);
  }

  // Player rows
  const showLegs = s.lines.some((l) => l.legs > 0);
  let y = 240;
  for (const l of s.lines) {
    const isWinner = l.name === s.winnerName;
    ctx.fillStyle = isWinner ? "#fbbf24" : "#e5e5e5";
    ctx.font = `${isWinner ? 800 : 600} 28px system-ui, Segoe UI, sans-serif`;
    ctx.fillText(l.name, 48, y);
    ctx.fillStyle = "#a3a3a3";
    ctx.font = "500 24px system-ui, Segoe UI, sans-serif";
    const legPart = showLegs ? `${l.legs} leg${l.legs === 1 ? "" : "s"}   ` : "";
    ctx.fillText(`${legPart}${l.avg.toFixed(1)} avg   ${l.darts} darts`, 320, y);
    y += 52;
  }

  // Footer
  ctx.fillStyle = "#525252";
  ctx.font = "500 18px system-ui, Segoe UI, sans-serif";
  ctx.fillText("github.com/burgerearmuffs/granbridge", 48, H - 32);

  return canvas;
}

/** Trigger a PNG download of the card. Returns false when drawing/saving is unavailable. */
export function downloadResultCard(state: GameState): boolean {
  const canvas = drawResultCard(state);
  if (!canvas || typeof canvas.toDataURL !== "function") return false;
  try {
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `granbridge-result-${Date.now()}.png`;
    a.click();
    return true;
  } catch {
    return false;
  }
}
