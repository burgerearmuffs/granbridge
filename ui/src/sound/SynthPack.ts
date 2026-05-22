import type { SoundName } from "./decide";

/**
 * Web Audio synthesiser — generates all sounds procedurally.
 *
 * Safety contract:
 *  - Lazily creates a single AudioContext on the first play() call.
 *  - If window.AudioContext and window.webkitAudioContext are both absent
 *    (SSR / jsdom / old browser), every method is a silent no-op.
 */

type AnyAudioContext = AudioContext & { state: AudioContextState };

// Convenience: schedule a gain envelope attack→decay→release
function ramp(
  gain: GainNode,
  ctx: AudioContext,
  peakVal: number,
  attackTime: number,
  decayTime: number,
  sustainVal: number,
  releaseTime: number,
  startAt: number,
) {
  const t = startAt;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peakVal, t + attackTime);
  gain.gain.linearRampToValueAtTime(sustainVal, t + attackTime + decayTime);
  gain.gain.linearRampToValueAtTime(0, t + attackTime + decayTime + releaseTime);
}

export class SynthPack {
  private ctx: AnyAudioContext | null = null;

  private getCtx(): AnyAudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor =
        (typeof window !== "undefined" &&
          (window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext)) ||
        null;
      if (!Ctor) return null;
      this.ctx = new Ctor() as AnyAudioContext;
    } catch {
      return null;
    }
    return this.ctx;
  }

  /** Resume context if suspended (browsers require a gesture before first use). */
  private async resume(ctx: AnyAudioContext): Promise<void> {
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }

  play(name: SoundName, volume: number): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    // Fire-and-forget; resume is async but synthesis is scheduled via Web Audio
    // clock so timing is stable even if resume hasn't resolved yet.
    void this.resume(ctx).then(() => {
      try {
        this.synth(ctx, name, Math.max(0, Math.min(1, volume)));
      } catch {
        /* guard against any runtime error in synthesis */
      }
    });
  }

  private synth(ctx: AudioContext, name: SoundName, vol: number): void {
    const t = ctx.currentTime;

    switch (name) {
      case "hit":
        this.blip(ctx, t, 440, 0.06, vol * 0.4);
        break;

      case "hit-treble":
        // A short bright triad (major chord root-3rd-5th played rapidly)
        this.blip(ctx, t, 880, 0.06, vol * 0.4);
        this.blip(ctx, t + 0.03, 1100, 0.06, vol * 0.35);
        this.blip(ctx, t + 0.06, 1320, 0.06, vol * 0.3);
        break;

      case "hit-bull":
        // Rising tone
        this.slide(ctx, t, 300, 600, 0.18, vol * 0.5);
        break;

      case "miss":
        // Low soft thud
        this.blip(ctx, t, 160, 0.1, vol * 0.25, "triangle");
        break;

      case "bust":
        // Descending buzz
        this.slide(ctx, t, 400, 120, 0.28, vol * 0.5, "sawtooth");
        break;

      case "leg-won":
        // Two-note rising fanfare
        this.blip(ctx, t, 660, 0.12, vol * 0.5);
        this.blip(ctx, t + 0.14, 880, 0.18, vol * 0.5);
        break;

      case "game-won":
        // Three-note triumphant fanfare
        this.blip(ctx, t, 523, 0.12, vol * 0.6);
        this.blip(ctx, t + 0.14, 659, 0.12, vol * 0.6);
        this.blip(ctx, t + 0.28, 784, 0.25, vol * 0.6);
        this.blip(ctx, t + 0.55, 1047, 0.3, vol * 0.5);
        break;

      case "one-eighty": {
        // Triumphant ascending arpeggio (C major: C5 E5 G5 C6)
        const notes = [523, 659, 784, 1047];
        notes.forEach((freq, i) => {
          this.blip(ctx, t + i * 0.1, freq, 0.18, vol * 0.55);
        });
        break;
      }

      case "checkout-available":
        // Soft chime: pure sine, gentle bell-like decay
        this.chime(ctx, t, 880, vol * 0.35);
        this.chime(ctx, t + 0.15, 1108, vol * 0.25);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Primitive synthesisers
  // ---------------------------------------------------------------------------

  private blip(
    ctx: AudioContext,
    startAt: number,
    freq: number,
    duration: number,
    amp: number,
    type: OscillatorType = "sine",
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);
    osc.connect(gain);
    gain.connect(ctx.destination);
    ramp(gain, ctx, amp, 0.005, 0.01, amp * 0.6, duration - 0.015, startAt);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  private slide(
    ctx: AudioContext,
    startAt: number,
    fromFreq: number,
    toFreq: number,
    duration: number,
    amp: number,
    type: OscillatorType = "sine",
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromFreq, startAt);
    osc.frequency.linearRampToValueAtTime(toFreq, startAt + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    ramp(gain, ctx, amp, 0.01, 0.05, amp * 0.5, duration - 0.06, startAt);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  /** Bell-like chime: sine with sharp attack, long exponential decay. */
  private chime(ctx: AudioContext, startAt: number, freq: number, amp: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, startAt);
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(amp, startAt + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.8);
    osc.start(startAt);
    osc.stop(startAt + 0.85);
  }
}
