"""Generate PWA icons. Requires Pillow. Run: python3 scripts/make-icons.py"""
from pathlib import Path

from PIL import Image, ImageDraw

S = 1024
BG1 = (19, 24, 38)
BG2 = (9, 11, 16)
ACCENT = (111, 140, 255)
ACCENT2 = (59, 92, 246)
WHITE = (245, 247, 255)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "icons"


def gradient(size, top, bottom):
    img = Image.new("RGB", (size, size), top)
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        color = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
        draw.line([(0, y), (size, y)], fill=color)
    return img


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def draw_icon(size, maskable=False):
    scale = 4
    s = size * scale
    img = gradient(s, BG1, BG2)
    draw = ImageDraw.Draw(img)
    cx = cy = s / 2
    radius = s * (0.26 if maskable else 0.30)
    width = max(2, int(s * 0.018))

    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], outline=ACCENT, width=width)

    # Clock hands at roughly 23:30.
    draw.line([cx, cy, cx, cy - radius * 0.58], fill=WHITE, width=int(width * 1.15))
    draw.line([cx, cy, cx + radius * 0.42, cy + radius * 0.22], fill=WHITE, width=int(width * 1.15))
    draw.ellipse([cx - width * 0.9, cy - width * 0.9, cx + width * 0.9, cy + width * 0.9], fill=ACCENT)

    # Small send arrow, lower right.
    ax, ay = cx + radius * 0.72, cy + radius * 0.72
    draw.line([(ax - s * 0.075, ay - s * 0.020), (ax + s * 0.075, ay - s * 0.020)], fill=ACCENT2, width=int(width * 1.4))
    draw.line([(ax + s * 0.075, ay - s * 0.020), (ax + s * 0.020, ay - s * 0.075)], fill=ACCENT2, width=int(width * 1.4))

    img = img.resize((size, size), Image.LANCZOS).convert("RGBA")
    if not maskable:
        img.putalpha(rounded_mask(size, int(size * 0.22)))
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (512, 192):
        draw_icon(size).save(OUT / f"icon-{size}.png")
    draw_icon(512).resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png")
    draw_icon(512, maskable=True).save(OUT / "icon-maskable-512.png")
    print(f"icons written to {OUT}")


if __name__ == "__main__":
    main()
