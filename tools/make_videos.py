"""Generate the celebration / announcement video clips for ui/public/videos/.

Every clip is rendered procedurally (PIL frames piped straight into ffmpeg —
no intermediate files, no third-party footage): dark arena backdrop, rotating
gold rays, physics confetti and a broadcast-style headline with glow.

    .venv/Scripts/python tools/make_videos.py

Requires: numpy + Pillow (tools-only deps), ffmpeg on PATH.
The players mute these clips, so no audio track is encoded.
"""

from __future__ import annotations

import math
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 960, 540
FPS = 30
OUT_DIR = Path(__file__).resolve().parent.parent / "ui" / "public" / "videos"

GOLD = (255, 213, 74)
TEAL = (78, 205, 196)
RED = (232, 72, 72)
CREAM = (245, 240, 220)

FONT_CANDIDATES = [r"C:\Windows\Fonts\impact.ttf", r"C:\Windows\Fonts\ariblk.ttf"]


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Easing
# ---------------------------------------------------------------------------
def ease_out_back(x: float, overshoot: float = 1.7) -> float:
    x = min(max(x, 0.0), 1.0)
    c = overshoot
    return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2


def clamp01(x: float) -> float:
    return min(max(x, 0.0), 1.0)


# ---------------------------------------------------------------------------
# Scene layers
# ---------------------------------------------------------------------------
_BACKDROP_CACHE: dict[tuple[int, int, int], Image.Image] = {}


def backdrop(tint: tuple[int, int, int]) -> Image.Image:
    """Dark arena: radial vignette with a faint colored glow up top. Cached."""
    if tint in _BACKDROP_CACHE:
        return _BACKDROP_CACHE[tint].copy()
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    cx, cy = W / 2, H * 0.42
    d = np.sqrt(((xx - cx) / (W * 0.65)) ** 2 + ((yy - cy) / (H * 0.75)) ** 2)
    base = np.clip(1.0 - d, 0.0, 1.0) ** 1.6
    img = np.zeros((H, W, 3), dtype=np.float32)
    floor = np.array((10, 11, 14), dtype=np.float32)
    glow = np.array(tint, dtype=np.float32) * 0.16
    img += floor + base[..., None] * glow
    out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    _BACKDROP_CACHE[tint] = out
    return out.copy()


def draw_rays(img: Image.Image, angle: float, color: tuple[int, int, int], alpha: int, count: int = 14) -> None:
    """Rotating light rays from centre — drawn on an overlay, screen-blended."""
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    cx, cy = W / 2, H * 0.45
    reach = math.hypot(W, H)
    width = math.pi / count * 0.55
    for i in range(count):
        a = angle + i * (2 * math.pi / count)
        pts = [
            (cx, cy),
            (cx + reach * math.cos(a - width), cy + reach * math.sin(a - width)),
            (cx + reach * math.cos(a + width), cy + reach * math.sin(a + width)),
        ]
        d.polygon(pts, fill=(*color, alpha))
    img.alpha_composite(overlay)


@dataclass
class Confetto:
    x: float
    y: float
    vx: float
    vy: float
    size: float
    color: tuple[int, int, int]
    spin: float
    phase: float


def make_confetti(rng: np.random.Generator, count: int, burst: bool) -> list[Confetto]:
    palette = [GOLD, TEAL, (255, 107, 107), CREAM, (150, 206, 180), (221, 160, 221)]
    out = []
    for _ in range(count):
        if burst:
            ang = rng.uniform(0, 2 * math.pi)
            speed = rng.uniform(4, 14)
            x, y = W / 2 + rng.uniform(-60, 60), H * 0.45 + rng.uniform(-40, 40)
            vx, vy = math.cos(ang) * speed, math.sin(ang) * speed - 6
        else:
            x, y = rng.uniform(0, W), rng.uniform(-H, 0)
            vx, vy = rng.uniform(-1, 1), rng.uniform(2, 5)
        out.append(Confetto(
            x=x, y=y, vx=vx, vy=vy,
            size=rng.uniform(5, 12),
            color=palette[int(rng.integers(len(palette)))],
            spin=rng.uniform(-0.3, 0.3),
            phase=rng.uniform(0, 2 * math.pi),
        ))
    return out


def step_confetti(parts: list[Confetto]) -> None:
    for p in parts:
        p.x += p.vx
        p.y += p.vy
        p.vy = min(p.vy + 0.22, 7.0)
        p.vx *= 0.99
        p.phase += p.spin


def draw_confetti(img: Image.Image, parts: list[Confetto]) -> None:
    d = ImageDraw.Draw(img)
    for p in parts:
        if p.y < -20 or p.y > H + 20:
            continue
        # Rotating rectangle via its 4 corners
        c, s = math.cos(p.phase), math.sin(p.phase)
        hw, hh = p.size / 2, p.size / 4
        pts = [
            (p.x + c * dx - s * dy, p.y + s * dx + c * dy)
            for dx, dy in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh))
        ]
        d.polygon(pts, fill=(*p.color, 235))


def headline(img: Image.Image, text: str, sub: str, color: tuple[int, int, int],
             scale: float, alpha: float, size: int = 150) -> None:
    """Broadcast headline: glow layer under sharp text, back-eased scale-in."""
    if alpha <= 0.01 or scale <= 0.01:
        return
    font = load_font(max(10, int(size * scale)))
    sub_font = load_font(max(8, int(34 * scale)))

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    a = int(255 * clamp01(alpha))
    cx, cy = W / 2, H * 0.46
    d.text((cx, cy), text, font=font, fill=(*color, a), anchor="mm")
    if sub:
        d.text((cx, cy + size * scale * 0.62), sub.upper(), font=sub_font,
               fill=(*CREAM, int(a * 0.8)), anchor="mm")

    glow = layer.filter(ImageFilter.GaussianBlur(10))
    img.alpha_composite(glow)
    img.alpha_composite(glow)  # double-composite → hotter glow
    img.alpha_composite(layer)


def draw_rings(img: Image.Image, progress: float) -> None:
    """Bullseye ring zoom: concentric red/gold rings collapsing to centre."""
    d = ImageDraw.Draw(img)
    cx, cy = W / 2, H * 0.46
    for i in range(5):
        r = (1.35 - progress) * (90 + i * 85)
        if r <= 6:
            continue
        color = RED if i % 2 == 0 else GOLD
        fade = int(200 * clamp01(1.4 - progress - i * 0.08))
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(*color, fade),
                  width=max(2, int(10 - i * 1.5)))


# ---------------------------------------------------------------------------
# Clip definitions
# ---------------------------------------------------------------------------
@dataclass
class ClipSpec:
    name: str
    dur: float
    text: str
    sub: str
    accent: tuple[int, int, int]
    confetti: int
    burst: bool
    text_size: int = 150
    rings: bool = False
    flashes: int = 0          # >0: text re-pops N times (the 180 triple-flash)


CLIPS = [
    ClipSpec("game-won", 6.0, "GAME SHOT!", "Game Won", GOLD, 220, True),
    ClipSpec("leg-won", 4.0, "LEG!", "Leg Won", TEAL, 130, True, text_size=190),
    ClipSpec("one-eighty", 2.6, "180", "One Eighty", GOLD, 260, True, text_size=260, flashes=3),
    ClipSpec("treble-twenty", 2.2, "TREBLE 20!", "", GOLD, 70, True, text_size=130),
    ClipSpec("treble-nineteen", 2.2, "TREBLE 19!", "", GOLD, 70, True, text_size=130),
    ClipSpec("treble-eighteen", 2.2, "TREBLE 18!", "", GOLD, 70, True, text_size=130),
    ClipSpec("bullseye", 2.2, "BULLSEYE!", "", RED, 60, True, text_size=140, rings=True),
]


def render_frame(spec: ClipSpec, parts: list[Confetto], frame: int, total: int) -> Image.Image:
    tt = frame / FPS
    progress = frame / max(1, total - 1)
    img = backdrop(spec.accent).convert("RGBA")

    # Rays fade in fast, spin slowly, fade near the end
    ray_alpha = int(46 * clamp01(tt / 0.25) * clamp01((1 - progress) / 0.25))
    if ray_alpha > 0:
        draw_rays(img, tt * 0.55, spec.accent, ray_alpha)

    if spec.rings:
        draw_rings(img, clamp01(tt / (spec.dur * 0.55)))

    draw_confetti(img, parts)
    step_confetti(parts)

    # Headline timing: pop at 0.1 s, hold, fade over the last 12 %
    t_in = clamp01((tt - 0.10) / 0.30)
    alpha = clamp01((1 - progress) / 0.12)
    if spec.flashes > 0:
        # Re-pop the scale N times across the first 60% of the clip
        cycle = clamp01(tt / (spec.dur * 0.6)) * spec.flashes
        t_in = clamp01(cycle - math.floor(cycle)) if cycle < spec.flashes else 1.0
        t_in = clamp01(t_in * 2.2)
    scale = ease_out_back(t_in)
    headline(img, spec.text, spec.sub, spec.accent, scale, alpha * clamp01(tt / 0.12), spec.text_size)

    return img


def encode(spec: ClipSpec) -> None:
    total = int(spec.dur * FPS)
    rng = np.random.default_rng(hash(spec.name) % (2**32))
    parts = make_confetti(rng, spec.confetti, spec.burst)
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-preset", "medium",
         "-movflags", "+faststart", str(OUT_DIR / f"{spec.name}.mp4")],
        stdin=subprocess.PIPE,
    )
    assert proc.stdin is not None
    for frame in range(total):
        img = render_frame(spec, parts, frame, total)
        proc.stdin.write(img.convert("RGB").tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg failed for {spec.name}")
    size_mb = (OUT_DIR / f"{spec.name}.mp4").stat().st_size / (1024 * 1024)
    print(f"  {spec.name}.mp4  {spec.dur:.1f}s  {size_mb:5.2f} MB")
    assert size_mb < 20, f"{spec.name} exceeds the 20 MB budget"


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Rendering {len(CLIPS)} clips to {OUT_DIR} ({W}x{H} @ {FPS} fps)")
    for spec in CLIPS:
        encode(spec)
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
