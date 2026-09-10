from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "icons"
SCALE = 8
BASE = 128
SIZE = BASE * SCALE


def scaled(points):
    return [(round(x * SCALE), round(y * SCALE)) for x, y in points]


def vertical_gradient(size, top, bottom):
    image = Image.new("RGBA", (size, size))
    pixels = image.load()
    for y in range(size):
        t = y / max(1, size - 1)
        color = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(4))
        for x in range(size):
            pixels[x, y] = color
    return image


canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

# Studio Deck graphite faceplate; no halo, restrained corners and amber mark.
mask = Image.new("L", (SIZE, SIZE), 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.rounded_rectangle(
    (5 * SCALE, 5 * SCALE, 123 * SCALE, 123 * SCALE),
    radius=12 * SCALE,
    fill=255,
)
background = vertical_gradient(SIZE, (55, 60, 49, 255), (37, 42, 32, 255))
background.putalpha(mask)
canvas.alpha_composite(background)

draw = ImageDraw.Draw(canvas)
draw.rounded_rectangle(
    (5 * SCALE, 5 * SCALE, 123 * SCALE - 1, 123 * SCALE - 1),
    radius=12 * SCALE,
    outline=(121, 131, 103, 255),
    width=2 * SCALE,
)

# Playback Plus: a single play triangle and a separate plus, readable at 16 px.
mark_mask = Image.new("L", (SIZE, SIZE), 0)
mark_draw = ImageDraw.Draw(mark_mask)
mark_draw.polygon(scaled([(29, 34), (29, 94), (73, 64)]), fill=255)
mark_draw.rectangle((80 * SCALE, 60 * SCALE, 108 * SCALE, 68 * SCALE), fill=255)
mark_draw.rectangle((90 * SCALE, 50 * SCALE, 98 * SCALE, 78 * SCALE), fill=255)
mark = vertical_gradient(SIZE, (242, 198, 122, 255), (225, 165, 69, 255))
mark.putalpha(mark_mask)
canvas.alpha_composite(mark)

# Fine highlights keep the symbol crisp at toolbar sizes.
draw = ImageDraw.Draw(canvas)
draw.line(scaled([(34, 40), (34, 88)]), fill=(255, 237, 189, 160), width=2 * SCALE)

OUTPUT.mkdir(parents=True, exist_ok=True)
for target_size in (16, 32, 48, 96):
    resized = canvas.resize((target_size, target_size), Image.Resampling.LANCZOS)
    resized.save(OUTPUT / f"icon-{target_size}.png", optimize=True)

print("Generated icons:", ", ".join(str(OUTPUT / f"icon-{size}.png") for size in (16, 32, 48, 96)))
