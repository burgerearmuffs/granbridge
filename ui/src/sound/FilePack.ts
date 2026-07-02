import type { SoundName } from "./decide";
import type { SoundPack } from "./SoundManager";

/**
 * Real-audio sound pack backed by files from SOUND_MANIFEST.
 *
 * Loading strategy (per sound, lazy):
 *  - First play() kicks off fetch + decodeAudioData and plays the fallback
 *    pack in the meantime, so a cue is never silent.
 *  - Once decoded, subsequent plays use the cached AudioBuffer.
 *  - A failed fetch/decode marks that sound as failed forever — it delegates
 *    to the fallback pack from then on, with no re-fetch.
 *  - If Web Audio is unavailable entirely, every play delegates.
 */
export class FilePack implements SoundPack {
  private ctx: AudioContext | null = null;
  private buffers = new Map<SoundName, AudioBuffer>();
  private loading = new Map<SoundName, Promise<void>>();
  private failed = new Set<SoundName>();

  constructor(
    private manifest: Record<SoundName, string>,
    private fallback: SoundPack,
  ) {}

  private getCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor =
        (typeof window !== "undefined" &&
          (window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext)) ||
        null;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    return this.ctx;
  }

  play(name: SoundName, volume: number): void {
    const ctx = this.getCtx();
    if (!ctx || this.failed.has(name)) {
      this.fallback.play(name, volume);
      return;
    }

    const buffer = this.buffers.get(name);
    if (buffer) {
      this.playBuffer(ctx, buffer, volume);
      return;
    }

    // Not loaded yet: start (or join) the load, cover this play with synth.
    if (!this.loading.has(name)) {
      this.loading.set(name, this.load(ctx, name));
    }
    this.fallback.play(name, volume);
  }

  private async load(ctx: AudioContext, name: SoundName): Promise<void> {
    try {
      const res = await fetch(this.manifest[name]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      const buffer = await ctx.decodeAudioData(data);
      this.buffers.set(name, buffer);
    } catch {
      this.failed.add(name);
    } finally {
      this.loading.delete(name);
    }
  }

  private playBuffer(ctx: AudioContext, buffer: AudioBuffer, volume: number): void {
    // Fire-and-forget resume; the source can be started immediately — Web Audio
    // queues it and playback begins as soon as the context is running.
    void this.resume(ctx);
    try {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = buffer;
      gain.gain.value = Math.max(0, Math.min(1, volume));
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(0);
    } catch {
      /* never let playback errors escape into game handling */
    }
  }

  private async resume(ctx: AudioContext): Promise<void> {
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }
}
