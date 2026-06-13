/**
 * Tournament view — local single-elimination bracket night on one board.
 *
 * Setup: 2–8 named players + a game mode → bracket (byes auto-resolve).
 * Play: "Play this match" starts the engine game over the bridge; when the
 * board reports the game finished, the winner advances automatically. Manual
 * "mark winner" buttons cover unplugged-board nights.
 */

import { useEffect, useMemo, useState } from "react";
import { useTournamentStore } from "../tournament/store";
import { currentMatch, champion, MAX_PLAYERS, MIN_PLAYERS, type TMatch } from "../tournament/bracket";
import { bridgeLink } from "../bridgeLink";
import { useStore } from "../store";

const MODES = [
  { id: "x01-501", label: "X01 — 501 double out", mode: "x01", options: { start_score: 501, double_out: true } },
  { id: "x01-301", label: "X01 — 301 double out", mode: "x01", options: { start_score: 301, double_out: true } },
  { id: "cricket", label: "Cricket", mode: "cricket", options: {} },
  { id: "around_the_clock", label: "Around the Clock", mode: "around_the_clock", options: {} },
  { id: "count_up", label: "Count-Up", mode: "count_up", options: {} },
];

function MatchCard({ m, highlight, playing }: { m: TMatch; highlight: boolean; playing: boolean }) {
  const line = (name: string | null, isWinner: boolean) => (
    <div
      className={[
        "px-3 py-1.5 text-sm flex items-center justify-between gap-2",
        isWinner ? "text-amber-300 font-bold" : name ? "text-neutral-200" : "text-neutral-600 italic",
      ].join(" ")}
    >
      <span>{name ?? "—"}</span>
      {isWinner && <span aria-label={`${name} won`}>✓</span>}
    </div>
  );
  return (
    <div
      data-testid={`match-${m.id}`}
      className={[
        "rounded-lg border divide-y divide-neutral-800 bg-neutral-900 min-w-40",
        highlight ? "border-amber-400" : "border-neutral-800",
        playing ? "ring-2 ring-amber-400/50" : "",
      ].join(" ")}
    >
      {line(m.p1, m.winner !== null && m.winner === m.p1)}
      {line(m.p2, m.winner !== null && m.winner === m.p2)}
    </div>
  );
}

export function Tournament() {
  const bracket = useTournamentStore((s) => s.bracket);
  const config = useTournamentStore((s) => s.config);
  const playingMatchId = useTournamentStore((s) => s.playingMatchId);
  const gameState = useStore((s) => s.gameState);

  const [names, setNames] = useState<string[]>(["", ""]);
  const [modeId, setModeId] = useState(MODES[0].id);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  const next = useMemo(() => (bracket ? currentMatch(bracket) : null), [bracket]);
  const winnerName = useMemo(() => (bracket ? champion(bracket) : null), [bracket]);
  const playing = useMemo(
    () => bracket?.rounds.flat().find((m) => m.id === playingMatchId) ?? null,
    [bracket, playingMatchId],
  );

  // Auto-advance: when the board finishes the game we started for this match,
  // map the engine's winning slot back to a name and record it.
  useEffect(() => {
    if (!playing || !gameState || gameState.status !== "finished" || !gameState.winner) return;
    const stateNames = gameState.players.map((p) => p.name);
    if (!(stateNames.includes(playing.p1 ?? "") && stateNames.includes(playing.p2 ?? ""))) return;
    const winnerPlayer = gameState.players.find((p) => p.id === gameState.winner);
    if (!winnerPlayer) return;
    useTournamentStore.getState().recordWinner(playing.id, winnerPlayer.name);
  }, [gameState, playing]);

  const createTournament = () => {
    try {
      const cfg = MODES.find((m) => m.id === modeId) ?? MODES[0];
      useTournamentStore.getState().create(names, { mode: cfg.mode, options: cfg.options });
      setFormError(null);
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const playMatch = (m: TMatch) => {
    if (!config || !m.p1 || !m.p2) return;
    bridgeLink.send({ command: "start_game", mode: config.mode, players: [m.p1, m.p2], options: config.options } as never);
    useTournamentStore.getState().setPlayingMatchId(m.id);
  };

  // ── Setup form ──────────────────────────────────────────────────────────────
  if (!bracket) {
    return (
      <div className="max-w-md mx-auto mt-8 space-y-4">
        <h2 className="text-2xl font-bold">Tournament night</h2>
        <p className="text-neutral-400 text-sm">
          Single-elimination bracket for {MIN_PLAYERS}–{MAX_PLAYERS} players on this board.
          Winners advance automatically as games finish.
        </p>

        {names.map((n, i) => (
          <div key={i} className="flex gap-2">
            <input
              type="text"
              value={n}
              onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={`Player ${i + 1}`}
              aria-label={`Player ${i + 1} name`}
              className="flex-1 bg-neutral-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            {names.length > MIN_PLAYERS && (
              <button
                onClick={() => setNames(names.filter((_, j) => j !== i))}
                aria-label={`Remove player ${i + 1}`}
                className="px-3 rounded-lg bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
              >
                ×
              </button>
            )}
          </div>
        ))}

        {names.length < MAX_PLAYERS && (
          <button
            onClick={() => setNames([...names, ""])}
            className="text-sm text-amber-300 hover:text-amber-200"
            aria-label="Add player"
          >
            + Add player
          </button>
        )}

        <label className="block">
          <span className="text-sm text-neutral-300">Game</span>
          <select
            value={modeId}
            onChange={(e) => setModeId(e.target.value)}
            aria-label="Tournament game mode"
            className="mt-1 w-full bg-neutral-800 rounded-lg px-3 py-2 text-sm"
          >
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>

        {formError && <p role="alert" className="text-sm text-red-300">{formError}</p>}

        <button
          onClick={createTournament}
          disabled={names.filter((n) => n.trim()).length < MIN_PLAYERS}
          className="w-full py-2.5 rounded-lg bg-amber-400 text-neutral-900 font-bold text-sm hover:bg-amber-300 disabled:opacity-40"
          aria-label="Create bracket"
        >
          Create bracket
        </button>
      </div>
    );
  }

  // ── Bracket view ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Tournament</h2>
        {confirmAbandon ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-red-300">Abandon the bracket?</span>
            <button
              onClick={() => useTournamentStore.getState().clear()}
              className="px-3 py-1.5 rounded-lg bg-red-600 font-bold hover:bg-red-500"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmAbandon(false)}
              className="px-3 py-1.5 rounded-lg bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            >
              No
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmAbandon(true)}
            className="text-sm text-neutral-500 hover:text-neutral-300"
            aria-label="Abandon tournament"
          >
            Abandon
          </button>
        )}
      </div>

      {winnerName && (
        <div role="status" className="bg-amber-400 text-neutral-900 rounded-xl px-6 py-4 text-center space-y-2">
          <p className="text-2xl font-black">🏆 {winnerName} wins the tournament!</p>
          <button
            onClick={() => useTournamentStore.getState().clear()}
            className="px-4 py-2 rounded-lg bg-neutral-900 text-amber-300 text-sm font-bold"
          >
            New tournament
          </button>
        </div>
      )}

      {/* Bracket grid: one column per round */}
      <div className="flex gap-6 overflow-x-auto pb-2">
        {bracket.rounds.map((round, r) => (
          <div key={r} className="flex flex-col justify-around gap-4 min-w-44">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500 text-center">
              {r === bracket.rounds.length - 1 ? "Final" : r === bracket.rounds.length - 2 && bracket.rounds.length > 1 ? "Semifinals" : `Round ${r + 1}`}
            </h3>
            {round.map((m) => (
              <MatchCard key={m.id} m={m} highlight={next?.id === m.id} playing={playingMatchId === m.id} />
            ))}
          </div>
        ))}
      </div>

      {/* Next match controls */}
      {next && !winnerName && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl px-5 py-4 flex items-center gap-4 flex-wrap">
          <span className="text-sm text-neutral-300">
            Up next: <strong className="text-white">{next.p1}</strong> vs <strong className="text-white">{next.p2}</strong>
          </span>
          {playingMatchId === next.id ? (
            <span className="text-sm text-amber-300 animate-pulse">In progress on the board — winner advances automatically</span>
          ) : (
            <button
              onClick={() => playMatch(next)}
              className="px-4 py-2 rounded-lg bg-amber-400 text-neutral-900 text-sm font-bold hover:bg-amber-300"
              aria-label="Play this match"
            >
              ▶ Play this match
            </button>
          )}
          <span className="text-xs text-neutral-500 ml-auto">or record manually:</span>
          <button
            onClick={() => useTournamentStore.getState().recordWinner(next.id, next.p1!)}
            className="px-3 py-1.5 rounded-lg bg-neutral-800 text-xs text-neutral-300 hover:bg-neutral-700"
            aria-label={`Mark ${next.p1} as winner`}
          >
            {next.p1} won
          </button>
          <button
            onClick={() => useTournamentStore.getState().recordWinner(next.id, next.p2!)}
            className="px-3 py-1.5 rounded-lg bg-neutral-800 text-xs text-neutral-300 hover:bg-neutral-700"
            aria-label={`Mark ${next.p2} as winner`}
          >
            {next.p2} won
          </button>
        </div>
      )}
    </div>
  );
}
