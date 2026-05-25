import { useState } from "react";
import type { Command } from "../types";
import { PageHeader } from "../components/Page";

interface Props {
  send: (c: Command) => void;
}

export function Setup({ send }: Props) {
  const [mode, setMode] = useState("x01");
  const [playersRaw, setPlayersRaw] = useState("");
  // X01 options
  const [startScore, setStartScore] = useState<301 | 501 | 701>(501);
  const [doubleOut, setDoubleOut] = useState(false);
  const [bestOfLegs, setBestOfLegs] = useState(1);
  const [rounds, setRounds] = useState(8);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const players = playersRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const options: Record<string, unknown> =
      mode === "x01"
        ? { start_score: startScore, double_out: doubleOut, best_of_legs: bestOfLegs }
        : mode === "count_up"
        ? { rounds }
        : {};

    send({ command: "start_game", mode, players, options });
  };

  const label = "block text-sm font-semibold text-neutral-300 mb-1";
  const input =
    "w-full rounded-xl px-4 py-2 bg-neutral-800 text-white border border-neutral-600 focus:border-amber-400 focus:outline-none";
  const select =
    "rounded-xl px-4 py-2 bg-neutral-800 text-white border border-neutral-600 focus:border-amber-400 focus:outline-none";

  return (
    <div className="flex justify-center items-center min-h-[60vh]">
      <form
        onSubmit={handleSubmit}
        className="bg-neutral-900 rounded-2xl p-8 w-full max-w-md space-y-6 shadow-xl"
      >
        <PageHeader title="New Game" />

        {/* Mode */}
        <div>
          <label className={label} htmlFor="mode-select">
            Mode
          </label>
          <select
            id="mode-select"
            className={select}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="x01">X01</option>
            <option value="cricket">Cricket</option>
            <option value="around_the_clock">Around the Clock</option>
            <option value="free_play">Free Play</option>
            <option value="count_up">Count-Up</option>
            <option value="medley">Medley</option>
          </select>
        </div>

        {/* Players */}
        <div>
          <label className={label} htmlFor="players-input">
            Players
          </label>
          <input
            id="players-input"
            aria-label="players"
            className={input}
            type="text"
            placeholder="Ann, Bo, Charlie"
            value={playersRaw}
            onChange={(e) => setPlayersRaw(e.target.value)}
          />
          <p className="text-xs text-neutral-500 mt-1">Comma-separated names</p>
        </div>

        {/* X01 options */}
        {mode === "x01" && (
          <div className="space-y-4 border border-neutral-700 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-widest">
              X01 Options
            </h3>

            <div>
              <label className={label} htmlFor="start-score">
                Starting Score
              </label>
              <select
                id="start-score"
                className={select}
                value={startScore}
                onChange={(e) =>
                  setStartScore(Number(e.target.value) as 301 | 501 | 701)
                }
              >
                <option value={301}>301</option>
                <option value={501}>501</option>
                <option value={701}>701</option>
              </select>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="double-out"
                type="checkbox"
                checked={doubleOut}
                onChange={(e) => setDoubleOut(e.target.checked)}
                className="w-4 h-4 accent-amber-400"
              />
              <label htmlFor="double-out" className="text-sm text-neutral-300 font-medium">
                Double Out
              </label>
            </div>

            <div>
              <label className={label} htmlFor="best-of-legs">
                Best of Legs
              </label>
              <input
                id="best-of-legs"
                type="number"
                min={1}
                max={99}
                value={bestOfLegs}
                onChange={(e) => setBestOfLegs(Number(e.target.value))}
                className={`${input} w-24`}
              />
            </div>
          </div>
        )}

        {mode === "count_up" && (
          <div className="space-y-4 border border-neutral-700 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-widest">
              Count-Up Options
            </h3>
            <div>
              <label className={label} htmlFor="rounds">
                Rounds
              </label>
              <input
                id="rounds"
                aria-label="rounds"
                type="number"
                min={1}
                max={50}
                value={rounds}
                onChange={(e) => setRounds(Number(e.target.value))}
                className={`${input} w-24`}
              />
            </div>
          </div>
        )}

        {mode === "medley" && (
          <div className="space-y-2 border border-neutral-700 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-widest">
              Medley
            </h3>
            <p className="text-sm text-neutral-400">
              A best-of-3 match: X01 (501), then Cricket, then Count-Up. First to win 2 games takes the match.
            </p>
          </div>
        )}

        <button
          type="submit"
          className="w-full rounded-xl py-3 text-lg font-bold bg-amber-400 hover:bg-amber-300 text-neutral-950 transition-colors"
        >
          Start Game
        </button>
      </form>
    </div>
  );
}
