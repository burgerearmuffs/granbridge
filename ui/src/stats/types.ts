export interface MatchRecord {
  match_id: string;
  mode: string;
  opponent_id: string | null;
  winner_id: string | null;
  is_remote: boolean;
  darts: number;
  total_scored: number;
  started_at: string;
  ended_at: string;
  throws?: { bed: string; score: number; ts: string }[];
}

export interface Identity {
  id: string;
  writeToken: string;
  name: string;
  avatarColor: string;
}

export interface PlayerSummary {
  id: string;
  display_name: string | null;
  avatar_color: string | null;
  games_played: number;
  wins: number;
  verified_games: number;
  darts: number;
  total_scored: number;
  three_dart_avg: number;
  heatmap: Record<string, number>;
}

export interface LeaderRow {
  id: string;
  display_name: string | null;
  avatar_color: string | null;
  games: number;
  wins: number;
  three_dart_avg: number;
}

export interface QueueEntry {
  record: MatchRecord;
  identity: Identity;
}
