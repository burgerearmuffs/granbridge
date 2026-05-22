import { create } from "zustand";
import type { Event, GameState } from "./types";

interface Banner { kind: string; text: string; at: number; }
interface State {
  connection: string;
  gameState: GameState | null;
  banners: Banner[];
  setConnection: (s: string) => void;
  applyEvent: (e: Event) => void;
  reset: () => void;
}
const BANNER_CAP = 5;

export const useStore = create<State>((set) => ({
  connection: "disconnected",
  gameState: null,
  banners: [],
  setConnection: (s) => set({ connection: s }),
  reset: () => set({ connection: "disconnected", gameState: null, banners: [] }),
  applyEvent: (e) =>
    set((st) => {
      if (e.type === "game_state") return { gameState: e.state };
      if (e.type === "connection_state") return { connection: e.state };
      if (e.type === "bust") return push(st, "bust", `BUST — ${e.player}`);
      if (e.type === "leg_won") return push(st, "leg_won", `Leg to ${e.player}`);
      if (e.type === "game_won") return push(st, "game_won", `🏆 ${e.player} wins`);
      return {};
    }),
}));

function push(st: State, kind: string, text: string) {
  const banners = [...st.banners, { kind, text, at: Date.now() }].slice(-BANNER_CAP);
  return { banners };
}
