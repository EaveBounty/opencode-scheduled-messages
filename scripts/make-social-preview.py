"""Generate the GitHub social preview (1280x640). Run: python3 scripts/make-social-preview.py"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "social-preview.png"
ICON = ROOT / "public" / "icons" / "icon-512.png"
W, H = 1280, 640

TOP = (17, 22, 36)
BOTTOM = (7, 9, 14)
ACCENT = (111, 140, 255)
MUTED = (150, 161, 184)
WHITE = (240, 244, 255)


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def gradient(width, height):
    img = Image.new("RGB", (width, height), TOP)
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / (height - 1)
        color = tuple(round(TOP[i] * (1 - t) + BOTTOM[i] * t) for i in range(3))
        draw.line([(0, y), (width, y)], fill=color)
    return img


def main():
    img = gradient(W, H).convert("RGBA")
    draw = ImageDraw.Draw(img)

    # Accent hairline at the top.
    draw.rectangle([0, 0, W, 4], fill=ACCENT)

    # Soft glow behind the icon.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([70, 130, 430, 490], fill=(59, 92, 246, 34))
    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)

    icon = Image.open(ICON).convert("RGBA").resize((196, 196), Image.LANCZOS)
    img.alpha_composite(icon, (120, 222))

    title_font = font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 64)
    sub_font = font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 30)
    small_font = font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
    mono_font = font("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 20)

    x = 390
    draw.text((x, 196), "OpenCode", font=title_font, fill=WHITE)
    draw.text((x, 266), "Scheduled Messages", font=title_font, fill=ACCENT)
    draw.text((x, 352), "Write at peak. Send off-peak.", font=sub_font, fill=MUTED)
    draw.text((x, 398), "Append to an existing session — not a new one.", font=small_font, fill=(190, 200, 220))

    pills = ["zero deps", "SQLite queue", "mobile PWA", "Tailscale ready"]
    px = x
    for pill in pills:
        bbox = draw.textbbox((0, 0), pill, font=mono_font)
        width = bbox[2] - bbox[0] + 28
        draw.rounded_rectangle([px, 470, px + width, 512], radius=21, outline=(70, 82, 108), width=1, fill=(22, 28, 44))
        draw.text((px + 14, 480), pill, font=mono_font, fill=(190, 200, 220))
        px += width + 12

    draw.text((x, 556), "github.com/EaveBounty/opencode-scheduled-messages", font=mono_font, fill=(110, 122, 148))
    draw.text((120, 556), "v0.1", font=mono_font, fill=(110, 122, 148))

    img.convert("RGB").save(OUT, quality=95)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
