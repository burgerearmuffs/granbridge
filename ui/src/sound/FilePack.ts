import type { SoundName } from "./decide";
import type { SoundPack } from "./SoundManager";

/**
 * Real-audio sound pack backed by files from SOUND_MANIFEST.
 *
 * Loading strategy (per sound, lazy, three tiers):
 *  1. fetch + decodeAudioData → cached AudioBuffer (lowest latency, overlaps
 *     freely). First play() kicks this off and plays the fallback pack in the
 *     meantime, so a cue is never silent.
 *  2. If the fetch/decode path fails, probe an HTMLAudioElement instead.
 *     Media-element requests take a different network path than fetch() and
 *     survive content filters that intercept XHR audio responses.
 *  3. If both fail, that sound delegates to the fallback pack (SynthPack)
 *     forever — no re-fetching.
 *
 * If Web Audio is unavailable entirely, every play delegates immediately.
 */
export class FilePack implements SoundPack {
  private ctx: AudioContext | null = null;
  private buffers = new Map<SoundName, AudioBuffer>();
  private elements = new Map<SoundName, HTMLAudioElement>();
  private loading = new Set<SoundName>();
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

    const element = this.elements.get(name);
    if (element) {
      this.playElement(element, name, volume);
      return;
    }

    // Not loaded yet: start (or join) the load, cover this play with synth.
    if (!this.loading.has(name)) {
      this.loading.add(name);
      void this.load(ctx, name);
    }
    this.fallback.play(name, volume);
  }

  private async load(ctx: AudioContext, name: SoundName): Promise<void> {
    try {
      const res = await fetch(this.manifest[name]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      if (data.byteLength === 0) throw new Error("empty body");
      const buffer = await ctx.decodeAudioData(data);
      this.buffers.set(name, buffer);
      this.loading.delete(name);
    } catch {
      this.probeElement(name);
    }
  }

  /** Tier 2: see whether an <audio> element can load the clip instead. */
  private probeElement(name: SoundName): void {
    if (typeof Audio === "undefined") {
      this.failed.add(name);
      this.loading.delete(name);
      return;
    }
    try {
      const el = new Audio(this.manifest[name]);
      el.preload = "auto";
      el.addEventListener(
        "canplaythrough",
        () => {
          this.elements.set(name, el);
          this.loading.delete(name);
        },
        { once: true },
      );
      el.addEventListener(
        "error",
        () => {
          this.failed.add(name);
          this.loading.delete(name);
        },
        { once: true },
      );
      el.load();
    } catch {
      this.failed.add(name);
      this.loading.delete(name);
    }
  }

  private playElement(template: HTMLAudioElement, name: SoundName, volume: number): void {
    try {
      // Clone so rapid repeats overlap instead of restarting one element.
      const el = template.cloneNode(true) as HTMLAudioElement;
      el.volume = Math.max(0, Math.min(1, volume));
      void el.play()?.catch?.(() => this.fallback.play(name, volume));
    } catch {
      this.fallback.play(name, volume);
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
