export type Ring = "SO" | "SI" | "D" | "T" | "SBULL" | "DBULL" | "OUT";
export interface Player { id: string; name: string; }
export interface Dart { bed: string; ring: string; segment: number | null; multiplier: number; score: number; }
export interface PlayerStats { darts: number; total_scored: number; three_dart_avg: number; }
export interface GameState {
  mode: string; status: "waiting" | "in_progress" | "finished";
  players: Player[]; active_index: number; leg_starter_index?: number;
  visit: Dart[]; legs: Record<string, number>; sets: Record<string, number>;
  winner: string | null; options: Record<string, unknown>;
  mode_view: Record<string, any>; stats: Record<string, PlayerStats>;
}
export type Event =
  | { type: "connection_state"; state: string; device: string | null; rssi: number | null }
  | { type: "dart_hit"; bed: string; ring: string; segment: number | null; multiplier: number; score: number }
  | { type: "game_started"; mode: string; players: Player[]; options: Record<string, unknown> }
  | { type: "game_state"; state: GameState }
  | { type: "bust"; player: string; score_attempted: number; reason: string }
  | { type: "leg_won"; player: string; legs: number; sets: number }
  | { type: "game_won"; player: string }
  | { type: "error"; category: string; message: string };
export type Command =
  | { command: "start_game"; mode: string; players: string[]; options: Record<string, unknown> }
  | { command: "next_player" } | { command: "record_miss" } | { command: "undo" }
  | { command: "correct_last"; bed: string } | { command: "end_game" };
