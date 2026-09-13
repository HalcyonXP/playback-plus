"""Generate the approved GB1 play-plus PNGs and matching SVG. Requires Pillow.

Use --output for review without replacing runtime assets. No network access.
"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SCALE = 8
BASE = 128
SIZES = (16, 32, 48, 96)
FACE_TOP = (48, 52, 59)  # #30343b
FACE_BOTTOM = (32, 36, 43)  # #20242b
MARK = "#9bcaff"
EDGE = "#58616e"
OUTLINE = "#0d1017"
SHAPES = (
    ((29, 34), (29, 94), (73, 64)),
    ((80, 60), (90, 60), (90, 50), (98, 50), (98, 60), (108, 60),
     (108, 68), (98, 68), (98, 78), (90, 78), (90, 68), (80, 68)),
)


def generate(output):
    size = BASE * SCALE
    canvas = Image.new("RGBA", (size, size))
    mask = Image.new("L", (size, size))
    ImageDraw.Draw(mask).rounded_rectangle(
        (5 * SCALE, 5 * SCALE, 123 * SCALE, 123 * SCALE), radius=8 * SCALE, fill=255)
    background = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(background)
    for y in range(size):
        t = y / (size - 1)
        colour = tuple(round(a * (1 - t) + b * t) for a, b in zip(FACE_TOP, FACE_BOTTOM))
        draw.line((0, y, size, y), fill=colour + (255,))
    background.putalpha(mask)
    canvas.alpha_composite(background)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((5 * SCALE, 5 * SCALE, 123 * SCALE - 1, 123 * SCALE - 1),
                           radius=8 * SCALE, outline=EDGE, width=2 * SCALE)
    for shape in SHAPES:
        points = [(x * SCALE, y * SCALE) for x, y in shape]
        draw.polygon(points, fill=MARK)
        draw.line(points + [points[0]], fill=OUTLINE, width=round(1.5 * SCALE), joint="curve")

    output.mkdir(parents=True, exist_ok=True)
    for target in SIZES:
        canvas.resize((target, target), Image.Resampling.LANCZOS).save(
            output / f"icon-{target}.png", optimize=True)

    # Both formats use the same geometry and colours; SVG has no filters/glow.
    paths = "\n".join('    <path d="M' + 'L'.join(f'{x} {y}' for x, y in shape) + 'Z"/>' for shape in SHAPES)
    top, bottom = "#" + bytes(FACE_TOP).hex(), "#" + bytes(FACE_BOTTOM).hex()
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <title>Playback Plus</title>
  <defs><linearGradient id="face" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="128">
    <stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/>
  </linearGradient></defs>
  <rect x="5" y="5" width="118" height="118" rx="8" fill="url(#face)"/>
  <rect x="6" y="6" width="116" height="116" rx="7" fill="none" stroke="{EDGE}" stroke-width="2"/>
  <g fill="{MARK}" stroke="{OUTLINE}" stroke-width="1.5" stroke-linejoin="round">
{paths}
  </g>
</svg>
'''
    (output / "icon.svg").write_text(svg, encoding="utf-8")
    print("Generated GB1 icons in:", output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "icons")
    generate(parser.parse_args().output)
