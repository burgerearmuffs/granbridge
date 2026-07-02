/**
 * Entrance (walk-on) themes — self-generated video + fanfare per style.
 * Assets ship in ui/public (tools/make_entrances.py, tools/make_sounds.py);
 * missing files degrade gracefully in the overlay (text-only card).
 */

export type EntranceTheme = "gold" | "teal" | "inferno";

export interface EntranceSpec {
  label: string;
  /** Accent used for the name text + picker chip. */
  accent: string;
  video: string;
  sound: string;
}

export const ENTRANCE_THEMES: Record<EntranceTheme, EntranceSpec> = {
  gold: {
    label: "Gold Standard",
    accent: "#ffd54a",
    video: "/videos/entrance-gold.mp4",
    sound: "/sounds/entrance-gold.mp3",
  },
  teal: {
    label: "Cool Runnings",
    accent: "#4ecdc4",
    video: "/videos/entrance-teal.mp4",
    sound: "/sounds/entrance-teal.mp3",
  },
  inferno: {
    label: "Inferno",
    accent: "#ff5a36",
    video: "/videos/entrance-inferno.mp4",
    sound: "/sounds/entrance-inferno.mp3",
  },
};

export function isEntranceTheme(value: unknown): value is EntranceTheme {
  return value === "gold" || value === "teal" || value === "inferno";
}

/** Overlay display cap — a stuck video never blocks the game beyond this. */
export const ENTRANCE_CAP_MS = 4500;
export const ENTRANCE_REDUCED_MS = 1500;
