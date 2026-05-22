/**
 * Keys that map to video clips.
 */
export type VideoKey = "game-won" | "leg-won";

/**
 * Pure function: given a banner kind string, return the VideoKey or null.
 *
 * game_won  → "game-won"
 * leg_won   → "leg-won"
 * anything else → null
 *
 * Intentionally stateless so it is trivial to unit-test.
 */
export function videoForEvent(kind: string): VideoKey | null {
  if (kind === "game_won") return "game-won";
  if (kind === "leg_won") return "leg-won";
  return null;
}
