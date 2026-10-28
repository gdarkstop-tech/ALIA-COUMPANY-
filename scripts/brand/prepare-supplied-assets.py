"""
Prepares the brand files the project owner supplied (store/assets/official/tetrasol/*-supplied.png)
for the apps. The artwork itself is never redrawn or recoloured: only the white backdrop is removed
so the files sit on any surface, and a tagline-free crop is cut for sizes where the tagline would be
unreadable.

  python3 scripts/brand/prepare-supplied-assets.py

Outputs (committed): apps/mobile/assets/brand/{tetrasol-logo,tetrasol-wordmark,loader-swirl}.png and
the same files under apps/admin/public/brand/.
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'store/assets/official/tetrasol'
OUT = [ROOT / 'apps/mobile/assets/brand', ROOT / 'apps/admin/public/brand']

# Measured from the supplied logo (650 x 250): the orange "Sol" box and the navy ink.
ORANGE_BOX = (360, 18, 635, 192)  # x0, y0, x1, y1 (inclusive)
NAVY = np.array([26, 28, 98])
WORDMARK_BOTTOM = 200  # the tagline starts at y = 209


def logo() -> Image.Image:
    px = np.array(Image.open(SRC / 'tetrasol-logo-supplied.png').convert('RGBA')).astype(float)
    h, w = px.shape[:2]
    out = np.zeros_like(px)
    ys, xs = np.mgrid[0:h, 0:w]
    x0, y0, x1, y1 = ORANGE_BOX
    inside = (xs >= x0) & (xs <= x1) & (ys >= y0) & (ys <= y1)
    # Outside the orange box there is only navy ink on white: the ink's coverage becomes alpha
    # (anti-aliased edges and letter counters stay correct on any background).
    cover = np.clip(((255 - px[..., :3]) / (255 - NAVY)).mean(axis=2), 0, 1)
    out[..., :3] = NAVY
    out[..., 3] = np.round(cover * 255)
    # The orange box (with its white letters) is kept exactly as supplied.
    out[inside] = px[inside]
    out[inside, 3] = 255
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


def swirl() -> Image.Image:
    px = np.array(Image.open(SRC / 'loader-swirl-supplied.png').convert('RGBA')).astype(float) / 255
    rgb, a0 = px[..., :3], px[..., 3]
    # "Colour to alpha" against white: identical on white, clean on dark surfaces.
    a = np.clip((1 - rgb).max(axis=2), 0, 1)
    safe = np.where(a > 0, a, 1)[..., None]
    col = np.clip((rgb - 1) / safe + 1, 0, 1)
    out = np.dstack([col, a * a0])
    img = Image.fromarray(np.round(out * 255).astype(np.uint8), 'RGBA')
    return img.resize((288, 288), Image.LANCZOS)


def trim(img: Image.Image, pad: int = 2) -> Image.Image:
    box = img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    x0, y0, x1, y1 = box
    return img.crop((max(x0 - pad, 0), max(y0 - pad, 0), min(x1 + pad, img.width), min(y1 + pad, img.height)))


full = trim(logo())
wordmark = trim(logo().crop((0, 0, 650, WORDMARK_BOTTOM)))
loader = swirl()
for d in OUT:
    d.mkdir(parents=True, exist_ok=True)
    full.save(d / 'tetrasol-logo.png', optimize=True)
    wordmark.save(d / 'tetrasol-wordmark.png', optimize=True)
    loader.save(d / 'loader-swirl.png', optimize=True)
print('logo', full.size, 'wordmark', wordmark.size, 'loader', loader.size)
