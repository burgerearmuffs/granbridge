/**
 * Single-elimination bracket — pure logic, no React, no storage.
 *
 * 2–8 named players. Field is padded to the next power of two; byes go to the
 * first-listed players (treat the entry order as seeding) and auto-resolve at
 * creation. All operations are immutable: they return a new Bracket.
 */

export interface TMatch {
  id: string;
  round: number;       // 0-based; final round has a single match
  index: number;       // position within the round
  p1: string | null;
  p2: string | null;
  winner: string | null;
}

export interface Bracket {
  players: string[];
  rounds: TMatch[][];
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Create a bracket. Throws on bad player counts, blank or duplicate names
 * (the engine identifies players by name, so duplicates would be ambiguous).
 */
export function createBracket(players: string[]): Bracket {
  const names = players.map((p) => p.trim());
  if (names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) {
    throw new Error(`player count must be ${MIN_PLAYERS}-${MAX_PLAYERS}`);
  }
  if (names.some((n) => !n)) throw new Error("player names must not be blank");
  if (new Set(names).size !== names.length) throw new Error("player names must be unique");

  const size = nextPow2(names.length);
  const byes = size - names.length;
  const roundCount = Math.log2(size);

  // Round 0: the first `byes` matches each hold one player + a bye.
  const first: TMatch[] = [];
  let cursor = 0;
  for (let i = 0; i < size / 2; i++) {
    const p1 = names[cursor++] ?? null;
    const p2 = i < byes ? null : names[cursor++] ?? null;
    first.push({ id: `m0-${i}`, round: 0, index: i, p1, p2, winner: null });
  }

  const rounds: TMatch[][] = [first];
  for (let r = 1; r < roundCount; r++) {
    const matches: TMatch[] = [];
    for (let i = 0; i < size / 2 ** (r + 1); i++) {
      matches.push({ id: `m${r}-${i}`, round: r, index: i, p1: null, p2: null, winner: null });
    }
    rounds.push(matches);
  }

  // Auto-resolve round-0 byes.
  let bracket: Bracket = { players: names, rounds };
  for (const m of first) {
    if (m.p1 !== null && m.p2 === null) bracket = reportWinner(bracket, m.id, m.p1);
  }
  return bracket;
}

/** Record a winner and propagate them into the next round. Returns a new Bracket. */
export function reportWinner(bracket: Bracket, matchId: string, winner: string): Bracket {
  const rounds = bracket.rounds.map((r) => r.map((m) => ({ ...m })));
  const match = rounds.flat().find((m) => m.id === matchId);
  if (!match) throw new Error(`unknown match: ${matchId}`);
  if (match.winner !== null) throw new Error(`match already decided: ${matchId}`);
  if (winner !== match.p1 && winner !== match.p2) {
    throw new Error(`${winner} is not in match ${matchId}`);
  }
  match.winner = winner;

  const next = rounds[match.round + 1]?.[match.index >> 1];
  if (next) {
    if (match.index % 2 === 0) next.p1 = winner;
    else next.p2 = winner;
  }
  return { players: bracket.players, rounds };
}

/** The next playable match (both slots filled, undecided), or null if none. */
export function currentMatch(bracket: Bracket): TMatch | null {
  for (const round of bracket.rounds) {
    for (const m of round) {
      if (m.p1 !== null && m.p2 !== null && m.winner === null) return m;
    }
  }
  return null;
}

/** The tournament winner, or null while play continues. */
export function champion(bracket: Bracket): string | null {
  const final = bracket.rounds[bracket.rounds.length - 1][0];
  return final.winner;
}
