import type { VideoKey } from "./decide";

/**
 * Maps each VideoKey to the public URL of its video clip.
 *
 * HOW TO ENABLE REAL CLIPS
 * -------------------------
 * Drop the corresponding .mp4 files into `ui/public/videos/`.
 * Vite serves everything in `public/` at the site root (no hashing), so
 * the files will be reachable at the paths below immediately.
 *
 * If a file is absent (404) the CheckoutOverlay falls back automatically
 * to the procedural CSS/text celebration — no code change required.
 *
 * Expected filenames:
 *   ui/public/videos/game-won.mp4  — played on game_won
 *   ui/public/videos/leg-won.mp4   — played on leg_won
 */
export const VIDEO_MANIFEST: Record<VideoKey, string> = {
  "game-won": "/videos/game-won.mp4",
  "leg-won":  "/videos/leg-won.mp4",
};
