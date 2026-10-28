#!/usr/bin/env python3
"""
Vectorises the supplied Dress My Wound reference artwork (store/assets/official/dmw/reference/)
into clean vector shapes, so every icon and logo size is rendered sharp from one master instead of
upscaling a low-resolution image.

  python3 -I scripts/brand/trace-dmw-reference.py      (needs: pillow, numpy, opencv-python-headless, potracer)

How: the wordmark reference is upscaled 4×, each brand colour (orange, medical silver, navy) becomes a
soft mask, the masks are smoothed, cleaned (specks and compression noise removed) and traced with
potrace (corner detection + optimised Bézier curves, outer shapes and holes), on a common grid. Shapes are only traced — never
redrawn by hand — so proportions, gaps and letterforms stay those of the supplied artwork. Colours are
the brand board's (Primary Orange #F97316, Text/Dark #1F2937, Medical Silver #9CA3AF) with the
reference's light-to-deep shading as gradients.

Output: packages/tokens/src/dmw-artwork.ts (consumed by the app, the admin console and
scripts/brand/generate-assets.ts). Re-run only when the reference changes; the output is committed.
"""
import json
import pathlib

import cv2
import numpy as np
import potrace
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
REF = ROOT / 'store/assets/official/dmw/reference/DMW_Inside_Full_Wordmark_Reference.webp'
OUT = ROOT / 'packages/tokens/src/dmw-artwork.ts'
K = 4  # supersampling factor

img = np.asarray(Image.open(REF).convert('RGB')).astype(np.float32)


def upscale(box):
    x0, y0, x1, y1 = box
    crop = Image.fromarray(img[y0:y1, x0:x1].astype(np.uint8))
    return np.asarray(crop.resize(((x1 - x0) * K, (y1 - y0) * K), Image.LANCZOS)).astype(np.float32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def masks(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    # Orange: strong red-over-blue; anti-aliased edges against white keep about half of it.
    orange = smoothstep(40, 110, r - b) * (r > 150)
    # Silver: grey (low saturation), darker than the near-white background.
    grey = (mx - mn) < 34
    # The background is pure white (254–255); silver runs from ~235 (highlights) down to ~95 (shadows).
    silver = smoothstep(251, 238, mx) * grey * (mx > 60)
    # Navy text: dark, blue-leaning.
    navy = smoothstep(150, 90, mx) * (b >= r - 8)
    return orange, silver, navy


def binarise(a, blur=1.6):
    a = cv2.GaussianBlur(a.astype(np.float32), (0, 0), blur * K / 3)
    return (a > 0.5).astype(np.uint8) * 255


def components(mask, min_area):
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area >= min_area:
            out.append(((labels == i).astype(np.uint8) * 255, (x, y, w, h, area)))
    return out


def fill_small_holes(mask, max_area):
    """Fills holes smaller than max_area (compression specks); real gaps (leaf veins, letter counters) are larger."""
    inv = (mask == 0).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(inv, 4)
    out = mask.copy()
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        touches = x == 0 or y == 0 or x + w == mask.shape[1] or y + h == mask.shape[0]
        if not touches and area < max_area:
            out[labels == i] = 255
    return out


def trace(mask, origin, scale, alphamax=1.0, tolerance=0.4):
    """All outlines (outer shapes and holes) of a binary mask as one even-odd path, in output units."""
    bm = potrace.Bitmap(mask == 0)  # potracer traces the False pixels
    plist = bm.trace(turdsize=30 * K, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY, alphamax=alphamax, opticurve=True, opttolerance=tolerance)
    f = lambda p: f'{(p.x / K + origin[0]) * scale:.2f} {(p.y / K + origin[1]) * scale:.2f}'
    d = []
    for curve in plist:
        d.append(f'M{f(curve.start_point)}')
        for seg in curve:
            if seg.is_corner:
                d.append(f'L{f(seg.c)}L{f(seg.end_point)}')
            else:
                d.append(f'C{f(seg.c1)} {f(seg.c2)} {f(seg.end_point)}')
        d.append('Z')
    return ''.join(d)


# ---------------------------------------------------------------- emblem
EMBLEM = (92, 236, 584, 690)  # x0, y0, x1, y1 in the reference
rgb = upscale(EMBLEM)
o, s, _ = masks(rgb)
om = binarise(o)
sm = binarise(s * (o < 0.25))
# The crop's right edge touches the wordmark's "D" (dark grey edges read as silver); silver never reaches past x≈420.
sm[:, (500 - EMBLEM[0]) * K:] = 0
# The subtitle's rule line runs under the heart's tip: drop thin horizontal silver pieces.
sm_parts = [m for m, (x, y, w, h, a) in components(sm, 900 * K) if h > 14 * K]
sm = fill_small_holes(np.clip(sum(sm_parts), 0, 255).astype(np.uint8), 60 * K * K)
om = fill_small_holes(om, 60 * K * K)
o_parts = components(om, 300 * K)
# The ECG trace is the only thin orange piece (≈ 2,000 px² in the reference; the cross arm and the
# heart lobe are many times larger).
ecg = [m for m, (x, y, w, h, a) in o_parts if a < 6000 * K * K]
solid = [m for m, (x, y, w, h, a) in o_parts if a >= 6000 * K * K]
U = 1  # 1 output unit per reference pixel
ox, oy = EMBLEM[0], EMBLEM[1]
emblem = {
    'viewBox': [EMBLEM[0], EMBLEM[1], EMBLEM[2] - EMBLEM[0], EMBLEM[3] - EMBLEM[1]],
    'orange': trace(np.clip(sum(solid), 0, 255).astype(np.uint8), (ox, oy), U),
    'silver': trace(sm, (ox, oy), U),
    'ecg': trace(np.clip(sum(ecg), 0, 255).astype(np.uint8), (ox, oy), U, alphamax=0.9) if ecg else '',
}

# ---------------------------------------------------------------- wordmark text
TEXT = (568, 470, 1590, 620)
rgb = upscale(TEXT)
o, _, n = masks(rgb)
text = {
    'viewBox': [TEXT[0], TEXT[1], TEXT[2] - TEXT[0], TEXT[3] - TEXT[1]],
    'dark': trace(fill_small_holes(binarise(n * (o < 0.3), 1.0), 30 * K * K), TEXT[:2], U, alphamax=0.8),
    'orange': trace(fill_small_holes(binarise(o, 1.0), 30 * K * K), TEXT[:2], U, alphamax=0.8),
}
# Tight bounds of the traced artwork (for layout).
def bounds(mask, origin):
    ys, xs = np.nonzero(mask)
    return [round(float(xs.min()) / K + origin[0], 1), round(float(ys.min()) / K + origin[1], 1), round(float(xs.max()) / K + origin[0], 1), round(float(ys.max()) / K + origin[1], 1)]

emblem['bounds'] = bounds(np.maximum(om, sm), EMBLEM[:2])
text['bounds'] = bounds(np.maximum(binarise(n, 1.2), binarise(o, 1.2)), TEXT[:2])

header = '''/**
 * Dress My Wound brand artwork as vector paths — GENERATED by scripts/brand/trace-dmw-reference.py
 * from the supplied reference (store/assets/official/dmw/reference/). Do not edit by hand.
 *
 *   emblem: cross + heart + ECG + leaf (no text) — the app icon and the mark.
 *   text:   the "Dress My Wound" letterforms (dark part + orange part) — the internal wordmark.
 * Coordinates are in reference-image pixels; each part carries its viewBox and tight bounds.
 */
'''
OUT.write_text(header + 'export const dmwArtwork = ' + json.dumps({'emblem': emblem, 'text': text}, indent=2) + ' as const;\n', encoding='utf-8')
print([(int(a / K / K), int(w / K), int(h / K)) for m, (x, y, w, h, a) in o_parts])
print(f'wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB); emblem bounds {emblem["bounds"]}, text bounds {text["bounds"]}, ecg parts {len(ecg)}')
