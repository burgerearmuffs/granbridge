import { create } from "zustand";
import type { Event, GameState } from "./types";
import { announceForHit, type AnnounceKey } from "./video/decide";
import type { EntranceTheme } from "./entrance/themes";

interface Banner { kind: string; text: string; at: number; }
export interface LastHit { bed: string; score: number; at: number; }
export interface CommentaryLine { text: string; at: number; }
export interface Announcement { key: AnnounceKey; at: number; }
export interface EntranceCue { theme: EntranceTheme; playerName: string; at: number; }
interface State {
  connection: string;
  gameState: GameState | null;
  banners: Banner[];
  lastHit: LastHit | null;
  commentary: CommentaryLine | null;
  /** Latest big-hit moment (Treble Twenty, Bullseye, One Eighty…). */
  announcement: Announcement | null;
  /** Walk-on cue fired when the local player starts a game. */
  entrance: EntranceCue | null;
  /** Scores of the current visit's darts (local mirror, for 180 detection). */
  visitScores: number[];
  setConnection: (s: string) => void;
  triggerEntrance: (theme: EntranceTheme, playerName: string) => void;
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
  announcement: null,
  entrance: null,
  visitScores: [],
  setConnection: (s) => set({ connection: s }),
  triggerEntrance: (theme, playerName) => set({ entrance: { theme, playerName, at: Date.now() } }),
  reset: () => set({
    connection: "disconnected", gameState: null, banners: [], lastHit: null,
    commentary: null, announcement: null, entrance: null, visitScores: [],
  }),
  applyEvent: (e) =>
    set((st) => {
      if (e.type === "game_state") {
        // Visit emptied (advance / leg end / new game) → restart 180 tracking.
        // visit is read defensively: state arrives over the wire.
        return (e.state.visit?.length ?? 0) === 0
          ? { gameState: e.state, visitScores: [] }
          : { gameState: e.state };
      }
      if (e.type === "connection_state") return { connection: e.state };
      if (e.type === "dart_hit") {
        const key = announceForHit(e.bed);
        let announcement = key ? { key, at: Date.now() } : st.announcement;
        let visitScores = [...st.visitScores, e.score];
        if (visitScores.length >= 3) {
          // A 180 outranks the third dart's own treble announcement.
          if (visitScores.slice(-3).reduce((a, b) => a + b, 0) === 180) {
            announcement = { key: "one-eighty", at: Date.now() };
          }
          visitScores = [];
        }
        return { lastHit: { bed: e.bed, score: e.score, at: Date.now() }, visitScores, announcement };
      }
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
