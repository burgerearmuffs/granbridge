"""Generate a placeholder GRANBRIDGE dartboard app icon (1024x1024 transparent PNG).

Build-time tool only (Pillow is not a runtime dependency). Output is fed to
`tauri icon` to produce the platform icon set. Run from the repo root:

    .venv/Scripts/python.exe tools/make_icon.py
"""
from __future__ import annotations

from PIL import Image, ImageDraw

SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

c = SIZE / 2.0
R = SIZE / 2.0 - 24      # board radius (leaves a margin)
SEG = 18.0               # 360 / 20 segments
start0 = -90.0 - SEG / 2.0  # put the "20" wedge centered at the top

BLACK = (24, 24, 27, 255)     # near-black segments (neutral-900)
CREAM = (244, 233, 197, 255)  # light segments
RED = (214, 40, 40, 255)
GREEN = (20, 140, 88, 255)
RIM = (10, 10, 12, 255)       # outer board rim


def wedges(r: float, even: tuple, odd: tuple) -> None:
    """Fill 20 alternating pie wedges out to radius r."""
    box = [c - r, c - r, c + r, c + r]
    for i in range(20):
        a0 = start0 + i * SEG
        d.pieslice(box, a0, a0 + SEG, fill=(even if i % 2 == 0 else odd))


# Outer rim, then base segments.
d.ellipse([c - R - 18, c - R - 18, c + R + 18, c + R + 18], fill=RIM)
wedges(R, CREAM, BLACK)

# Double ring (outer band): paint red/green to the edge, then restore the base inside 0.90R.
wedges(R, RED, GREEN)
wedges(R * 0.90, CREAM, BLACK)

# Triple ring (mid band): paint red/green to 0.60R, restore the base inside 0.50R.
wedges(R * 0.60, RED, GREEN)
wedges(R * 0.50, CREAM, BLACK)

# Bull.
d.ellipse([c - R * 0.10, c - R * 0.10, c + R * 0.10, c + R * 0.10], fill=GREEN)
d.ellipse([c - R * 0.05, c - R * 0.05, c + R * 0.05, c + R * 0.05], fill=RED)

OUT = "tools/granbridge-icon.png"
img.save(OUT)
print(f"wrote {OUT} {img.size}")
