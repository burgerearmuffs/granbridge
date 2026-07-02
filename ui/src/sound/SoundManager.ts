import type { Event } from "../types";
import { SoundDecider } from "./decide";
import { SynthPack } from "./SynthPack";
import { FilePack } from "./FilePack";
import { SOUND_MANIFEST } from "./manifest";
import type { SoundName } from "./decide";

const STORAGE_KEY = "granbridge.sound";

interface PersistedPrefs {
  enabled: boolean;
  volume: number;
}

/** Minimal interface that SoundManager calls on a pack. */
export interface SoundPack {
  play(name: SoundName, volume: number): void;
}

/**
 * Singleton sound manager.
 *
 * Holds user prefs (enabled, volume) persisted to localStorage and drives a
 * SoundDecider + SoundPack per incoming game event.
 *
 * The pack is injected at construction time so tests can substitute a fake.
 */
export class SoundManager {
  private enabled: boolean;
  private volume: number;
  private pack: SoundPack;
  private decider: SoundDecider;

  constructor(pack: SoundPack = new SynthPack()) {
    this.pack = pack;
    this.decider = new SoundDecider();

    // Load persisted prefs
    let prefs: PersistedPrefs = { enabled: true, volume: 0.6 };
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedPrefs>;
        if (typeof parsed.enabled === "boolean") prefs.enabled = parsed.enabled;
        if (typeof parsed.volume === "number") prefs.volume = parsed.volume;
      }
    } catch {
      /* ignore storage / parse errors */
    }

    this.enabled = prefs.enabled;
    this.volume = prefs.volume;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  handleEvent(event: Event): void {
    if (!this.enabled) return;
    const name = this.decider.decide(event);
    if (name !== null) {
      this.pack.play(name, this.volume);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.persist();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.persist();
  }

  getEnabled(): boolean {
    return this.enabled;
  }

  getVolume(): number {
    return this.volume;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private persist(): void {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ enabled: this.enabled, volume: this.volume }),
        );
      }
    } catch {
      /* ignore write errors (e.g. private mode quota) */
    }
  }
}

/** Application-wide singleton — import this everywhere.
 *  Real audio files from ui/public/sounds/ with per-sound SynthPack fallback. */
export const soundManager = new SoundManager(
  new FilePack(SOUND_MANIFEST, new SynthPack()),
);
