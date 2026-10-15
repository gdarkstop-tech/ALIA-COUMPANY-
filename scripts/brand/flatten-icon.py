"""Normalises store icon PNG formats.

  App Store icon (1024x1024): opaque RGB, no alpha     → python3 flatten-icon.py icon.png
  Google Play icon (512x512): 32-bit PNG (RGBA)        → python3 flatten-icon.py --rgba icon-512.png
"""
import sys

from PIL import Image

if sys.argv[1:2] == ["--rgba"]:
    for path in sys.argv[2:]:
        Image.open(path).convert("RGBA").save(path, optimize=True)
        print(f"{path}: RGBA")
    sys.exit(0)

for path in sys.argv[1:]:
    img = Image.open(path)
    if img.mode != "RGB":
        background = Image.new("RGB", img.size, (10, 31, 61))  # brand navy
        background.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
        background.save(path, optimize=True)
    print(f"{path}: {Image.open(path).mode} {Image.open(path).size}")
