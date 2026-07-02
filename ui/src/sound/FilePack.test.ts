import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FilePack } from "./FilePack";
import type { SoundPack } from "./SoundManager";
import type { SoundName } from "./decide";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------
function makeFakeFallback(): SoundPack & { calls: Array<{ name: SoundName; volume: number }> } {
  const calls: Array<{ name: SoundName; volume: number }> = [];
  return {
    calls,
    play(name: SoundName, volume: number) {
      calls.push({ name, volume });
    },
  };
}

interface FakeSource {
  buffer: unknown;
  started: boolean;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
}

class FakeAudioContext {
  state = "running";
  destination = { kind: "destination" };
  sources: FakeSource[] = [];
  gains: Array<{ value: number }> = [];
  decodeAudioData = vi.fn(async (_buf: ArrayBuffer) => ({ duration: 1 }));
  resume = vi.fn(async () => {
    this.state = "running";
  });

  createBufferSource(): FakeSource {
    const src: FakeSource = {
      buffer: null,
      started: false,
      connect: vi.fn(),
      start: vi.fn(() => {
        src.started = true;
      }),
    };
    this.sources.push(src);
    return src;
  }

  createGain() {
    const gainValue = { value: 1 };
    this.gains.push(gainValue);
    return { gain: gainValue, connect: vi.fn() };
  }
}

/** Fake HTMLAudioElement whose load outcome the test controls. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  static loadOutcome: "canplay" | "error" | "pending" = "pending";
  src: string;
  preload = "";
  volume = 1;
  played = 0;
  private listeners = new Map<string, () => void>();

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, cb: () => void) {
    this.listeners.set(type, cb);
  }

  load() {
    if (FakeAudio.loadOutcome !== "pending") {
      this.listeners.get(FakeAudio.loadOutcome === "canplay" ? "canplaythrough" : "error")?.();
    }
  }

  cloneNode(): FakeAudio {
    const clone = new FakeAudio(this.src);
    clone.volume = this.volume;
    return clone;
  }

  play() {
    this.played += 1;
    return Promise.resolve();
  }
}

const MANIFEST: Record<SoundName, string> = {
  "hit": "/sounds/hit.mp3",
  "hit-treble": "/sounds/hit-treble.mp3",
  "hit-bull": "/sounds/hit-bull.mp3",
  "miss": "/sounds/miss.mp3",
  "bust": "/sounds/bust.mp3",
  "leg-won": "/sounds/leg-won.mp3",
  "game-won": "/sounds/game-won.mp3",
  "one-eighty": "/sounds/one-eighty.mp3",
  "checkout-available": "/sounds/checkout-available.mp3",
};

// Let pending microtasks (fetch/decode chains) settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

let fakeCtx: FakeAudioContext;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fakeCtx = new FakeAudioContext();
  (window as unknown as { AudioContext: unknown }).AudioContext = vi.fn(() => fakeCtx);
  fetchMock = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  }));
  vi.stubGlobal("fetch", fetchMock);
  FakeAudio.instances = [];
  FakeAudio.loadOutcome = "pending";
  vi.stubGlobal("Audio", FakeAudio);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("FilePack", () => {
  it("delegates to fallback when no AudioContext exists", () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    const fallback = makeFakeFallback();
    const pack = new FilePack(MANIFEST, fallback);

    pack.play("hit", 0.5);

    expect(fallback.calls).toEqual([{ name: "hit", volume: 0.5 }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("first play starts a fetch and uses the fallback so the cue is not silent", async () => {
    const fallback = makeFakeFallback();
    const pack = new FilePack(MANIFEST, fallback);

    pack.play("hit", 0.5);

    expect(fallback.calls).toEqual([{ name: "hit", volume: 0.5 }]);
    expect(fetchMock).toHaveBeenCalledWith("/sounds/hit.mp3");
    await flush();
  });

  it("plays the decoded buffer (not the fallback) once loaded", async () => {
    const fallback = makeFakeFallback();
    const pack = new FilePack(MANIFEST, fallback);

    pack.play("hit", 0.5); // triggers load, falls back
    await flush();

    pack.play("hit", 0.8); // buffer ready → real playback
    expect(fallback.calls).toHaveLength(1);
    expect(fakeCtx.sources).toHaveLength(1);
    expect(fakeCtx.sources[0].started).toBe(true);
    expect(fakeCtx.gains[0].value).toBeCloseTo(0.8);
  });

  it("probes an <audio> element when fetch 404s and plays through it", async () => {
    fetchMock.mockResolvedValue({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) });
    FakeAudio.loadOutcome = "canplay";
    const fallback = makeFakeFallback();
    const pack = new FilePack(MANIFEST, fallback);

    pack.play("miss", 0.5); // load kicks off; synth covers
    await flush();

    pack.play("miss", 0.7); // element ready → media-element playback
    expect(fallback.calls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fakeCtx.sources).toHaveLength(0);
    // template + one clone; the clone actually played at the right volume
    const clone = FakeAudio.instances[FakeAudio.instances.length - 1];
    expect(clone.played).toBe(1);
    expect(clone.volume).toBeCloseTo(0.7);
  });

  it("probes the element path when the fetched body is empty (filtered response)", async () => {
    fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
    FakeAudio.loadOutcome = "canplay";
    const fallback = makeFakeFallback();
    const pack = new FilePack(MANIFEST, fallback);

    pack.play("hit", 0.5);
    await flush();
    pack.play("hit", 0.6);

    expect(fakeCtx.decodeAudioData).not.toHaveBeenCalled();
    expect(FakeAudio.instances[FakeAudio.instances.length - 1].played).toBe(1);
  });

  it("falls back permanently when both fetch and element fail, without re-fetching", async () => {
    fetchMock.mockResolvedValue({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) });
    FakeAudio.loadOutcome = "error";
    const fallback = makeFakeFallback();
    const pack = new FilePack(MANIFEST, fallback);

    pack.play("miss", 0.5);
    await flush();
    pack.play("miss", 0.5);
    await flush();

    expect(fallback.calls).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fakeCtx.sources).toHaveLength(0);
  });

  it("falls back to synth (and probes element) when decode fails", async () => {
    fakeCtx.decodeAudioData.mockRejectedValue(new Error("bad data"));
    FakeAudio.loadOutcome = "error";
    const fallback = makeFakeFallback();
    const pack = new FilePack(MANIFEST, fallback);

    pack.play("bust", 0.4);
    await flush();
    pack.play("bust", 0.4);
    await flush();

    expect(fallback.calls).toHaveLength(2);
    expect(fakeCtx.sources).toHaveLength(0);
  });

  it("does not double-fetch on rapid repeated plays while loading", async () => {
    const fallback = makeFakeFallback();
    const pack = new FilePack(MANIFEST, fallback);

    pack.play("hit", 0.5);
    pack.play("hit", 0.5);
    pack.play("hit", 0.5);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fallback.calls).toHaveLength(3); // all pre-load plays fell back
  });

  it("loads each sound independently", async () => {
    const fallback = makeFakeFallback();
    const pack = new FilePack(MANIFEST, fallback);

    pack.play("hit", 0.5);
    pack.play("bust", 0.5);
    await flush();

    expect(fetchMock).toHaveBeenCalledWith("/sounds/hit.mp3");
    expect(fetchMock).toHaveBeenCalledWith("/sounds/bust.mp3");

    pack.play("hit", 0.6);
    pack.play("bust", 0.6);
    expect(fakeCtx.sources).toHaveLength(2);
  });

  it("resumes a suspended context before buffer playback", async () => {
    fakeCtx.state = "suspended";
    const fallback = makeFakeFallback();
    const pack = new FilePack(MANIFEST, fallback);

    pack.play("hit", 0.5);
    await flush();
    pack.play("hit", 0.5);
    await flush();

    expect(fakeCtx.resume).toHaveBeenCalled();
  });
});
