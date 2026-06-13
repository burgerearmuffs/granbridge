import { create } from "zustand";
import type { Event, GameState } from "./types";

interface Banner { kind: string; text: string; at: number; }
export interface LastHit { bed: string; score: number; at: number; }
export interface CommentaryLine { text: string; at: number; }
interface State {
  connection: string;
  gameState: GameState | null;
  banners: Banner[];
  lastHit: LastHit | null;
  commentary: CommentaryLine | null;
  setConnection: (s: string) => void;
  applyEvent: (e: Event) => void;
  reset: () => void;
}
const BANNER_CAP = 5;

export const useStore = create<State>((set) => ({
  connection: "disconnected",
  gameState: null,
  banners: [],
  lastHit: null,
  commentary: null,
  setConnection: (s) => set({ connection: s }),
  reset: () => set({ connection: "disconnected", gameState: null, banners: [], lastHit: null, commentary: null }),
  applyEvent: (e) =>
    set((st) => {
      if (e.type === "game_state") return { gameState: e.state };
      if (e.type === "connection_state") return { connection: e.state };
      if (e.type === "dart_hit") return { lastHit: { bed: e.bed, score: e.score, at: Date.now() } };
      if (e.type === "bust") return push(st, "bust", `BUST — ${e.player}`);
      if (e.type === "leg_won") return push(st, "leg_won", `Leg to ${e.player}`);
      if (e.type === "game_won") return push(st, "game_won", `🏆 ${e.player} wins`);
      if (e.type === "commentary") return { commentary: { text: e.text, at: Date.now() } };
      return {};
    }),
}));

function push(st: State, kind: string, text: string) {
  const banners = [...st.banners, { kind, text, at: Date.now() }].slice(-BANNER_CAP);
  return { banners };
}
