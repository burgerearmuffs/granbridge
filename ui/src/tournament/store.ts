/**
 * Tournament store — the active local bracket, persisted to localStorage so a
 * crash or restart mid-tournament doesn't lose the night's bracket.
 */

import { create } from "zustand";
import { createBracket, reportWinner, type Bracket } from "./bracket";

const LS_KEY = "granbridge.tournament";

export interface TournamentConfig {
  mode: string;                       // engine mode id, e.g. "x01"
  options: Record<string, unknown>;   // engine start options
}

interface Persisted {
  bracket: Bracket;
  config: TournamentConfig;
}

function load(): Persisted | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed?.bracket?.rounds || !parsed?.config?.mode) return null;
    return parsed;
  } catch {
    return null;
  }
}

function save(p: Persisted | null): void {
  try {
    if (p) localStorage.setItem(LS_KEY, JSON.stringify(p));
    else localStorage.removeItem(LS_KEY);
  } catch { /* ignore */ }
}

interface TournamentState {
  bracket: Bracket | null;
  config: TournamentConfig | null;
  /** Match id currently being played on the board (started via the bridge). */
  playingMatchId: string | null;

  create: (players: string[], config: TournamentConfig) => void;
  recordWinner: (matchId: string, winner: string) => void;
  setPlayingMatchId: (id: string | null) => void;
  clear: () => void;
}

const initial = load();

export const useTournamentStore = create<TournamentState>((set, get) => ({
  bracket: initial?.bracket ?? null,
  config: initial?.config ?? null,
  playingMatchId: null,

  create: (players, config) => {
    const bracket = createBracket(players);
    save({ bracket, config });
    set({ bracket, config, playingMatchId: null });
  },

  recordWinner: (matchId, winner) => {
    const { bracket, config } = get();
    if (!bracket || !config) return;
    const next = reportWinner(bracket, matchId, winner);
    save({ bracket: next, config });
    set({ bracket: next, playingMatchId: null });
  },

  setPlayingMatchId: (id) => set({ playingMatchId: id }),

  clear: () => {
    save(null);
    set({ bracket: null, config: null, playingMatchId: null });
  },
}));
