import type { SoundName } from "./decide";

/**
 * Optional real-audio file manifest.
 *
 * Drop replacement audio files under `ui/public/sounds/` and switch the
 * SoundManager to use a FilePack (future implementation) to override the
 * built-in SynthPack synthesiser.
 *
 * Example FilePack usage (pseudocode, not yet implemented):
 *
 *   import { soundManager } from "./SoundManager";
 *   import { FilePack } from "./FilePack";
 *   soundManager.setPack(new FilePack(SOUND_MANIFEST));
 *
 * Files must be served from the `/sounds/` path at runtime. Vite will
 * serve anything placed in `ui/public/` as-is (no hashing).
 */
export const SOUND_MANIFEST: Record<SoundName, string> = {
  "hit":                "/sounds/hit.mp3",
  "hit-treble":         "/sounds/hit-treble.mp3",
  "hit-bull":           "/sounds/hit-bull.mp3",
  "miss":               "/sounds/miss.mp3",
  "bust":               "/sounds/bust.mp3",
  "leg-won":            "/sounds/leg-won.mp3",
  "game-won":           "/sounds/game-won.mp3",
  "one-eighty":         "/sounds/one-eighty.mp3",
  "checkout-available": "/sounds/checkout-available.mp3",
};
