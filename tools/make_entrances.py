"""Generate entrance (walk-on) theme assets: 3 videos + 3 fanfares.

Videos are deliberately TEXT-FREE backgrounds — EntranceOverlay draws the
player's name in the DOM on top, so one clip serves every player. Reuses the
scene toolkit from make_videos.py and the synth toolkit from make_sounds.py.

    .venv/Scripts/python tools/make_entrances.py
"""

from __future__ import annotations

import math
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_sounds as snd  # noqa: E402
import make_videos as vid  # noqa: E402

VIDEO_OUT = Path(__file__).resolve().parent.parent / "ui" / "public" / "videos"
GOLD = (255, 213, 74)
TEAL = (78, 205, 196)
INFERNO = (255, 90, 54)

DUR = 3.8  # under EntranceOverlay's 4.5 s cap


# ---------------------------------------------------------------------------
# Video backgrounds
# ---------------------------------------------------------------------------
def render_entrance(name: str, accent: tuple[int, int, int], embers: bool) -> None:
    total = int(DUR * vid.FPS)
    rng = np.random.default_rng(hash(name) % (2**32))
    parts = vid.make_confetti(rng, 90, burst=False)
    if embers:
        # Embers drift UP from the floor instead of raining down.
        for p in parts:
            p.y = vid.H + rng.uniform(0, vid.H)
            p.vy = -rng.uniform(1.5, 4.0)
            p.color = (255, int(rng.uniform(90, 180)), 40)

    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{vid.W}x{vid.H}",
         "-r", str(vid.FPS), "-i", "-",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-preset", "medium",
         "-movflags", "+faststart", str(VIDEO_OUT / f"{name}.mp4")],
        stdin=subprocess.PIPE,
    )
    assert proc.stdin is not None
    for frame in range(total):
        tt = frame / vid.FPS
        progress = frame / max(1, total - 1)
        img = vid.backdrop(accent).convert("RGBA")

        # Rays sweep in from black, spin, and hold; fade at the very end.
        ray_alpha = int(52 * vid.clamp01(tt / 0.5) * vid.clamp01((1 - progress) / 0.15))
        if ray_alpha > 0:
            vid.draw_rays(img, tt * 0.4 + math.sin(tt * 0.9) * 0.05, accent, ray_alpha)

        vid.draw_confetti(img, parts)
        vid.step_confetti(parts)
        if embers:
            for p in parts:  # embers never gain downward speed
                p.vy = min(p.vy, -1.0)
                if p.y < -20:
                    p.y = vid.H + 10

        proc.stdin.write(img.convert("RGB").tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg failed for {name}")
    size_mb = (VIDEO_OUT / f"{name}.mp4").stat().st_size / (1024 * 1024)
    print(f"  {name}.mp4  {DUR:.1f}s  {size_mb:5.2f} MB")


# ---------------------------------------------------------------------------
# Fanfares
# ---------------------------------------------------------------------------
def fanfare_gold() -> np.ndarray:
    """Regal three-chord brass rise with sparkle."""
    n = int(snd.SR * 2.6)
    mix = np.zeros(n)
    snd.overlay(mix, snd.chord([261.6, 329.6, 392.0], 0.35), 0.0)          # C
    snd.overlay(mix, snd.chord([349.2, 440.0, 523.3], 0.35), 0.32)         # F
    snd.overlay(mix, snd.chord([392.0, 493.9, 587.3, 784.0], 1.2), 0.64)   # G big
    snd.overlay(mix, snd.sparkle(2.0, 12), 0.4)
    return snd.reverb(mix, wet=0.22, decay=0.6)


def fanfare_teal() -> np.ndarray:
    """Cool synth arpeggio over a soft pad."""
    n = int(snd.SR * 2.6)
    mix = np.zeros(n)
    notes = [329.6, 392.0, 493.9, 659.3, 493.9, 392.0, 329.6, 659.3]       # Em pentatonic-ish
    for i, f in enumerate(notes):
        pluck = (snd.sine(f, 0.28) + 0.3 * snd.sine(f * 2, 0.28)) * snd.env_exp(0.28, 0.07) * 0.5
        snd.overlay(mix, pluck, 0.18 * i)
    pad = snd.chord([164.8, 246.9, 329.6], 2.2, detune=0.8) * 0.5
    snd.overlay(mix, pad, 0.0)
    return snd.reverb(mix, wet=0.28, decay=0.7)


def fanfare_inferno() -> np.ndarray:
    """Aggressive low power chord + riser + crackle."""
    n = int(snd.SR * 2.6)
    mix = np.zeros(n)
    power = np.tanh(2.5 * (snd.saw(82.4, 1.6) + snd.saw(123.5, 1.6) + 0.5 * snd.saw(82.9, 1.6)))
    snd.overlay(mix, power * snd.env_adsr(1.6, 0.01, 0.2, 0.7, 0.5) * 0.55, 0.0)
    riser = snd.sweep(200, 1400, 1.4, curve=1.6) * snd.env_adsr(1.4, 0.3, 0.2, 0.9, 0.3) * 0.25
    snd.overlay(mix, riser, 0.6)
    crackle = snd.bandpass(snd.noise(2.2), 1800, 8000) * snd.env_adsr(2.2, 0.2, 0.4, 0.5, 0.9) * 0.18
    # Sputtering ember gate on the crackle
    gate = (snd.rng.random(len(crackle)) > 0.6).astype(float)
    snd.overlay(mix, crackle * gate, 0.2)
    return snd.reverb(mix, wet=0.2, decay=0.55)


FANFARES = {
    "entrance-gold": fanfare_gold,
    "entrance-teal": fanfare_teal,
    "entrance-inferno": fanfare_inferno,
}


def main() -> int:
    VIDEO_OUT.mkdir(parents=True, exist_ok=True)
    print(f"Rendering 3 entrance videos to {VIDEO_OUT}")
    render_entrance("entrance-gold", GOLD, embers=False)
    render_entrance("entrance-teal", TEAL, embers=False)
    render_entrance("entrance-inferno", INFERNO, embers=True)
    print("Rendering 3 entrance fanfares")
    for name, build in FANFARES.items():
        snd.write_mp3(name, build(), max_dur=3.5)
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
