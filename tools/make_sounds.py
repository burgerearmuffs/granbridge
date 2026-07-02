"""Generate the shipped sound-effect files for ui/public/sounds/.

All audio is synthesised from scratch (numpy) — layered oscillators, shaped
noise, FFT band-filtering and a generated-impulse reverb — then encoded to MP3
via ffmpeg. Rerun after tweaking to regenerate every clip:

    .venv/Scripts/python tools/make_sounds.py

Requires: numpy (tools-only dep), ffmpeg on PATH.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 44100
OUT_DIR = Path(__file__).resolve().parent.parent / "ui" / "public" / "sounds"

rng = np.random.default_rng(1801)  # fixed seed → reproducible assets


# ---------------------------------------------------------------------------
# Building blocks
# ---------------------------------------------------------------------------
def t(dur: float) -> np.ndarray:
    return np.arange(int(SR * dur)) / SR


def sine(freq: float, dur: float, phase: float = 0.0) -> np.ndarray:
    return np.sin(2 * np.pi * freq * t(dur) + phase)


def saw(freq: float, dur: float) -> np.ndarray:
    x = (freq * t(dur)) % 1.0
    return 2.0 * x - 1.0


def square(freq: float, dur: float) -> np.ndarray:
    return np.sign(np.sin(2 * np.pi * freq * t(dur)))


def sweep(f0: float, f1: float, dur: float, curve: float = 1.0) -> np.ndarray:
    """Sine sweep from f0 to f1; curve > 1 spends longer near f0."""
    frac = np.linspace(0.0, 1.0, int(SR * dur)) ** curve
    freq = f0 + (f1 - f0) * frac
    phase = 2 * np.pi * np.cumsum(freq) / SR
    return np.sin(phase)


def env_exp(dur: float, decay: float) -> np.ndarray:
    """Exponential decay envelope (decay = time constant in seconds)."""
    return np.exp(-t(dur) / decay)


def env_adsr(dur: float, a: float, d: float, s: float, r: float) -> np.ndarray:
    n = int(SR * dur)
    na, nd, nr = int(SR * a), int(SR * d), int(SR * r)
    ns = max(0, n - na - nd - nr)
    parts = [
        np.linspace(0, 1, na, endpoint=False),
        np.linspace(1, s, nd, endpoint=False),
        np.full(ns, s),
        np.linspace(s, 0, nr),
    ]
    e = np.concatenate(parts)
    return e[:n] if len(e) >= n else np.pad(e, (0, n - len(e)))


def noise(dur: float) -> np.ndarray:
    return rng.standard_normal(int(SR * dur))


def bandpass(x: np.ndarray, lo: float, hi: float, soft: float = 0.3) -> np.ndarray:
    """FFT brick-band filter with raised-cosine edges (soft = edge width in octaves)."""
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    freqs = np.maximum(freqs, 1e-6)
    octaves_lo = np.log2(freqs / lo)
    octaves_hi = np.log2(hi / freqs)
    gain = np.clip(octaves_lo / soft, 0, 1) * np.clip(octaves_hi / soft, 0, 1)
    gain = 0.5 - 0.5 * np.cos(np.pi * gain)  # raised cosine
    return np.fft.irfft(spec * gain, n=len(x))


def fft_convolve(x: np.ndarray, h: np.ndarray) -> np.ndarray:
    n = len(x) + len(h) - 1
    nfft = 1 << (n - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(h, nfft), nfft)
    return y[:n]


def reverb(x: np.ndarray, wet: float = 0.18, decay: float = 0.5) -> np.ndarray:
    """Convolve with a generated exponential-decay noise IR (bright, hall-ish)."""
    n_ir = int(SR * decay * 3)
    ir = rng.standard_normal(n_ir) * np.exp(-(np.arange(n_ir) / SR) / decay)
    ir = bandpass(ir, 250, 9000)
    ir /= np.max(np.abs(ir)) + 1e-9
    tail = fft_convolve(x, ir) * 0.25
    out = np.pad(x, (0, len(tail) - len(x)))
    return out * (1 - wet) + tail * wet


def crowd(dur: float, attack: float, level: float = 1.0) -> np.ndarray:
    """Crowd roar: layered voice-band noise with slow attack and flutter."""
    base = np.zeros(int(SR * dur))
    for lo, hi, amt in ((250, 800, 1.0), (800, 2200, 0.7), (2200, 5000, 0.35)):
        base += bandpass(noise(dur), lo, hi) * amt
    # Flutter: slow random amplitude wobble so it breathes like a real crowd
    wob_pts = rng.uniform(0.6, 1.0, max(4, int(dur * 7)))
    wobble = np.interp(np.linspace(0, 1, len(base)), np.linspace(0, 1, len(wob_pts)), wob_pts)
    shape = env_adsr(dur, attack, dur * 0.15, 0.7, dur * 0.45)
    return base * wobble * shape * level * 0.25


def chord(freqs: list[float], dur: float, detune: float = 0.4) -> np.ndarray:
    """Brass-ish stab: detuned saw+square unison per note, ADSR."""
    out = np.zeros(int(SR * dur))
    for f in freqs:
        for cents in (-detune, 0.0, detune):
            fd = f * 2 ** (cents / 1200 * 8)
            out += saw(fd, dur) * 0.5 + square(fd, dur) * 0.18
    out = bandpass(out, 120, 7500)
    return out * env_adsr(dur, 0.012, 0.10, 0.55, dur * 0.45) / (len(freqs) * 3)


def sparkle(dur: float, count: int, lo: float = 1500, hi: float = 5200) -> np.ndarray:
    """Random high sine pings scattered across the clip (confetti for the ears)."""
    out = np.zeros(int(SR * dur))
    for _ in range(count):
        f = rng.uniform(lo, hi)
        ping = sine(f, 0.12) * env_exp(0.12, 0.03) * rng.uniform(0.15, 0.4)
        overlay(out, ping, rng.uniform(0, dur * 0.75))
    return out


def overlay(mix: np.ndarray, x: np.ndarray, at: float) -> None:
    """Add x into mix starting at `at` seconds, clipping to mix's length."""
    start = int(at * SR)
    end = min(len(mix), start + len(x))
    if end > start:
        mix[start:end] += x[: end - start]


def dart_thud(body_freq: float = 165.0, level: float = 1.0) -> np.ndarray:
    """Dart-into-sisal: filtered noise burst + pitch-dropping body knock."""
    dur = 0.16
    burst = bandpass(noise(dur), 900, 6000) * env_exp(dur, 0.012) * 0.8
    knock = sweep(body_freq, body_freq * 0.55, dur, curve=0.7) * env_exp(dur, 0.035) * 1.0
    tick = bandpass(noise(dur), 5000, 11000) * env_exp(dur, 0.004) * 0.35
    return (burst + knock + tick) * level


# ---------------------------------------------------------------------------
# Mastering + IO
# ---------------------------------------------------------------------------
def master(x: np.ndarray, peak_db: float = -1.0) -> np.ndarray:
    x = np.tanh(x * 1.2)  # gentle soft-clip glue
    x *= 10 ** (peak_db / 20) / (np.max(np.abs(x)) + 1e-9)
    # 3 ms fade-out so clips never click at the end
    fade = min(len(x), int(SR * 0.003))
    x[-fade:] *= np.linspace(1, 0, fade)
    return x


def widen(x: np.ndarray, ms: float = 8.0) -> np.ndarray:
    """Mono → stereo with a short inter-channel delay (Haas widening)."""
    shift = int(SR * ms / 1000)
    left = np.pad(x, (0, shift))
    right = np.pad(x, (shift, 0)) * 0.96
    return np.stack([left, right], axis=1)


def write_mp3(name: str, x: np.ndarray, max_dur: float = 3.0) -> None:
    # Trim to the clip budget with an 80 ms fade so reverb tails never click.
    limit = int(SR * max_dur)
    if len(x) > limit:
        x = x[:limit].copy()
        fade = int(SR * 0.08)
        x[-fade:] *= np.linspace(1, 0, fade)
    stereo = widen(master(x)) if x.ndim == 1 else master(x)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype(np.int16)
    with tempfile.TemporaryDirectory() as td:
        wav_path = Path(td) / f"{name}.wav"
        with wave.open(str(wav_path), "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        out = OUT_DIR / f"{name}.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path),
             "-codec:a", "libmp3lame", "-b:a", "192k", str(out)],
            check=True,
        )
    size_kb = (OUT_DIR / f"{name}.mp3").stat().st_size / 1024
    dur = len(stereo) / SR
    assert dur <= max_dur + 0.05, f"{name}: {dur:.2f}s exceeds its {max_dur}s budget"
    print(f"  {name}.mp3  {dur:5.2f}s  {size_kb:6.1f} KB")


# ---------------------------------------------------------------------------
# The nine sounds
# ---------------------------------------------------------------------------
def make_hit() -> np.ndarray:
    return reverb(dart_thud(), wet=0.06, decay=0.18)


def make_hit_treble() -> np.ndarray:
    thud = dart_thud(level=0.9)
    dur = 0.5
    shimmer = np.zeros(int(SR * dur))
    for i, f in enumerate((1800.0, 2400.0, 3200.0)):
        ping = (sine(f, 0.3) + 0.4 * sine(f * 2.01, 0.3)) * env_exp(0.3, 0.06) * 0.30
        overlay(shimmer, ping, 0.018 * i)
    mix = np.pad(thud, (0, len(shimmer) - len(thud))) + shimmer
    return reverb(mix, wet=0.10, decay=0.25)


def make_hit_bull() -> np.ndarray:
    thud = dart_thud(body_freq=140, level=0.95)
    rise = sweep(420, 940, 0.30) * env_adsr(0.30, 0.01, 0.05, 0.8, 0.12) * 0.4
    ping = sine(1880, 0.35) * env_exp(0.35, 0.09) * 0.3
    n = int(SR * 0.62)
    mix = np.zeros(n)
    overlay(mix, thud, 0.0)
    overlay(mix, rise, 0.02)
    overlay(mix, ping, 0.24)
    return reverb(mix, wet=0.12, decay=0.3)


def make_miss() -> np.ndarray:
    dur = 0.22
    thump = sweep(130, 58, dur, curve=0.6) * env_exp(dur, 0.05)
    knockles = bandpass(noise(dur), 150, 900) * env_exp(dur, 0.02) * 0.5
    return reverb(thump + knockles, wet=0.05, decay=0.15)


def make_bust() -> np.ndarray:
    buzz_dur = 0.42
    buzz = sweep(380, 110, buzz_dur, curve=0.9)
    buzz = np.tanh(3.0 * (buzz + 0.35 * sweep(382, 112, buzz_dur, curve=0.9)))
    buzz *= env_adsr(buzz_dur, 0.01, 0.08, 0.75, 0.14) * 0.7
    thud = dart_thud(body_freq=95, level=0.8)
    n = int(SR * 0.62)
    mix = np.zeros(n)
    overlay(mix, buzz, 0.0)
    overlay(mix, thud, 0.38)
    return reverb(mix, wet=0.10, decay=0.3)


def make_leg_won() -> np.ndarray:
    c1 = chord([261.6, 329.6, 392.0, 523.3], 0.42)          # C major
    c2 = chord([349.2, 440.0, 523.3, 698.5], 0.85)          # F major, higher
    roar = crowd(1.7, attack=0.20, level=0.8)
    n = int(SR * 1.8)
    mix = np.zeros(n)
    overlay(mix, c1, 0.0)
    overlay(mix, c2, 0.34)
    overlay(mix, roar, 0.0)
    overlay(mix, sparkle(1.4, 10) * 0.6, 0.0)
    return reverb(mix, wet=0.22, decay=0.6)


def make_game_won() -> np.ndarray:
    prog = [
        ([261.6, 329.6, 392.0], 0.30, 0.00),                 # C
        ([293.7, 370.0, 440.0], 0.30, 0.27),                 # D
        ([329.6, 415.3, 493.9], 0.32, 0.54),                 # E
        ([392.0, 493.9, 587.3, 784.0], 1.30, 0.82),          # G, big finish
    ]
    n = int(SR * 2.9)
    mix = np.zeros(n)
    for freqs, dur, at in prog:
        overlay(mix, chord(freqs, dur), at)
    overlay(mix, crowd(2.9, attack=0.25, level=1.0), 0.0)
    overlay(mix, sparkle(2.6, 22), 0.0)
    return reverb(mix, wet=0.25, decay=0.7)


def make_one_eighty() -> np.ndarray:
    notes = [523.3, 659.3, 784.0, 1046.5]                    # C5 E5 G5 C6
    n = int(SR * 2.4)
    mix = np.zeros(n)
    for i, f in enumerate(notes):
        overlay(mix, chord([f], 0.16, detune=0.6) * 0.8, 0.085 * i)
    stab = chord([261.6, 392.0, 523.3, 784.0, 1046.5], 1.1)  # unison C-stack stab
    overlay(mix, stab * 1.2, 0.40)
    overlay(mix, crowd(1.9, attack=0.12, level=1.1), 0.30)
    overlay(mix, sparkle(2.0, 16), 0.0)
    return reverb(mix, wet=0.24, decay=0.65)


def make_checkout_available() -> np.ndarray:
    def bell(f: float, dur: float) -> np.ndarray:
        return (sine(f, dur) + 0.5 * sine(f * 2.76, dur) + 0.2 * sine(f * 5.4, dur)) * env_exp(dur, 0.22)

    n = int(SR * 1.3)
    mix = np.zeros(n)
    b1 = bell(880, 1.0) * 0.5
    b2 = bell(1174.7, 1.0) * 0.4
    overlay(mix, b1, 0.0)
    overlay(mix, b2, 0.16)
    return reverb(mix, wet=0.15, decay=0.5)


# (builder, clip budget seconds) — mid-game cues stay tight; win fanfares get
# room for their reverb tail since they only fire at leg/game end.
BUILDERS: dict[str, tuple] = {
    "hit": (make_hit, 3.0),
    "hit-treble": (make_hit_treble, 3.0),
    "hit-bull": (make_hit_bull, 3.0),
    "miss": (make_miss, 3.0),
    "bust": (make_bust, 3.0),
    "leg-won": (make_leg_won, 3.5),
    "game-won": (make_game_won, 4.5),
    "one-eighty": (make_one_eighty, 3.5),
    "checkout-available": (make_checkout_available, 3.0),
}


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Writing {len(BUILDERS)} clips to {OUT_DIR}")
    for name, (build, max_dur) in BUILDERS.items():
        write_mp3(name, build(), max_dur)
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
