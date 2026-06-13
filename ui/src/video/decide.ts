/**
 * Keys that map to video clips.
 */
export type VideoKey = "game-won" | "leg-won";

/**
 * Big single-dart (and 180) announcement moments. Separate from VideoKey so the
 * fullscreen CheckoutOverlay's label maps stay exhaustive; both key families
 * share VIDEO_MANIFEST for their drop-a-file clip slots.
 */
export type AnnounceKey =
  | "treble-twenty"
  | "treble-nineteen"
  | "treble-eighteen"
  | "bullseye"
  | "one-eighty";

/** Map a single dart bed to its announcement, or null for an ordinary hit. */
export function announceForHit(bed: string): AnnounceKey | null {
  if (bed === "T20") return "treble-twenty";
  if (bed === "T19") return "treble-nineteen";
  if (bed === "T18") return "treble-eighteen";
  if (bed === "DBULL") return "bullseye";
  return null;
}

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
